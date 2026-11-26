// Mesh for iPhone — a home-screen web app served by the Mac app (phone-server.js).
// Same mesh engine as the desktop (mesh/mother/bubbles/organism.js); live data arrives over SSE,
// controls go back as small JSON POSTs. Pairing key: ?t=… in the URL, remembered on the phone.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// token counts the way people say them: 950, 7.7k, 77k, 1.1M, 12M, 1.3B
const fmtTok = v => { v = Math.max(0, v || 0); const u = v >= 1e9 ? [1e9, 'B'] : v >= 1e6 ? [1e6, 'M'] : v >= 1e3 ? [1e3, 'k'] : null; if (!u) return String(Math.round(v)); const x = v / u[0]; return (x < 10 ? x.toFixed(1).replace(/\.0$/, '') : Math.round(x)) + u[1]; };
// relays today (collector.js) and the sun / duplicate mark (main.js markSun)
const RELAYS = s => s.relaysToday ? ` · <span class="relays">⇄ ${s.relaysToday}</span>` : '';
const SUNTAG = s => s.sun ? ' <span class="stag sun">sun</span>' : s.dupOf ? ' <span class="stag dup">duplicate</span>' : '';
const ago = s => s < 60 ? Math.round(s) + 's' : s < 3600 ? Math.round(s / 60) + 'm' : s < 86400 ? (s / 3600).toFixed(1) + 'h' : Math.round(s / 86400) + 'd';

// ---------- pairing ----------
const qs = new URLSearchParams(location.search);
let TOKEN = qs.get('t') || localStorage.getItem('mesh.token') || '';
if (qs.get('t')) localStorage.setItem('mesh.token', qs.get('t'));
// the address keeps the key, so Add to Home Screen saves a paired app: the home-screen copy has its own storage
if (TOKEN && !qs.get('t')) history.replaceState(null, '', '?t=' + encodeURIComponent(TOKEN));
$('#today').onclick = () => openUsage();
$('#manifest').href = '/manifest.webmanifest?t=' + encodeURIComponent(TOKEN);
const api = (p, body) => fetch(p + (p.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(TOKEN), body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  .then(r => r.json().catch(() => ({ ok: r.ok })));

// Screen Sharing from the phone: a vnc:// link per Mac — iOS hands it to RVNC Viewer (or another VNC app).
// This Mac = the address the page was loaded from; the other Mac = its Tailscale address from peer.json.
const macName = l => ({ MacMini: 'Mac mini', MacBook: 'MacBook' })[l] || l;
// monochrome line icons (2026-11-16): no emoji anywhere in the phone UI — iOS draws emoji in colour and at its own size
const IC = (d, w = 18) => `<svg class="ic" width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  plus: IC('<path d="M12 5v14M5 12h14"/>'),
  up: IC('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  monitor: IC('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>', 17),
  laptop: IC('<rect x="4" y="5" width="16" height="10" rx="1.5"/><path d="M2 19h20"/>', 17),
  expand: IC('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>', 16),
  info: IC('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>', 18),
  gear: IC('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>', 13),
  pencil: IC('<path d="M4 20h4L19 9l-4-4L4 16v4z"/>', 15),
  flag: IC('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>', 12),
  code: IC('<path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/>', 17),
  spark: IC('<path d="M12 3v18M5 8c4 0 7 2 7 4s3 4 7 4M5 16c4 0 7-2 7-4s3-4 7-4"/>', 17),
  check: IC('<path d="M5 12l5 5 9-10"/>', 15),
};
// ---------- the look (2026-11-27): Default, or the desktop chat theme's Light / Dark / Match System ----------
// index.html sets html[data-theme] before the first paint; phone.css holds both palettes. Kept per phone (localStorage).
const THEMES = ['default', 'light', 'dark', 'system'];
let themePref = (() => { try { const v = localStorage.getItem('mesh.phoneTheme'); return THEMES.includes(v) ? v : 'system'; } catch { return 'system'; } })();
const themeLabel = p => p === 'default' ? 'Default' : p === 'system' ? 'Match System' : CHAT_THEME_NAME + (p === 'light' ? ' Light' : ' Dark');
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
const themeNow = () => themePref === 'system' ? (darkMQ.matches ? 'dark' : 'light') : themePref;
const termTheme = () => { const bg = (getComputedStyle(document.documentElement).getPropertyValue('--term-bg') || '').trim() || '#000000';
  return { background: bg, foreground: '#ececec', cursor: '#ede6d6', selectionBackground: 'rgba(255,255,255,.25)' }; };
function setTheme(p, quiet) {
  if (p) { themePref = p; try { localStorage.setItem('mesh.phoneTheme', p); } catch { } }
  const t = themeNow(), h = document.documentElement; h.dataset.theme = t; h.classList.toggle('ct', t !== 'default');
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = t === 'light' ? '#bacee0' : t === 'dark' ? '#1c1c1c' : '#000000';
  try { if (term) term.options.theme = termTheme(); } catch { }   // (term is declared further down: TDZ on the first call)
  if (!quiet && typeof render === 'function') { const d = $('#drawer'); d._html = ''; renderDrawer(); }
}
darkMQ.addEventListener && darkMQ.addEventListener('change', () => { if (themePref === 'system') setTheme(null); });
setTheme(null, true);
function renderVnc(snap) {
  const el = $('#vnc'), p = snap.peer, macs = [];
  if (/^[\w.-]+$/.test(location.hostname)) macs.push({ name: macName(p && p.selfLabel) || 'This Mac', host: location.hostname, on: true });
  if (p && p.host) macs.push({ name: macName(p.label), host: p.host, on: p.online });
  const html = macs.map(m => `<a class="vbtn${m.on ? '' : ' off'}" href="vnc://${m.host}" title="Screen share ${esc(m.name)} in RVNC Viewer" aria-label="Screen share ${esc(m.name)}">${/book/i.test(m.name) ? ICON.laptop : ICON.monitor}<span class="vl">${esc(m.name)}</span></a>`).join('');
  if (el._h !== html) { el.innerHTML = html; el._h = html; }      // compare with what we rendered: the display dot adds classes
  el.classList.toggle('hidden', !macs.length);
  if (typeof paintDisp === 'function') paintDisp();
}
// server display (display.js): a state dot on the Mac mini's screen-share button; long-press it to turn the display on/off
let dispSt = null, dispBusy = false;
function dispBtn() { return [...document.querySelectorAll('#vnc .vbtn')].find(b => !/book/i.test(b.getAttribute('aria-label') || '')); }
function paintDisp() {
  const b = dispBtn(); if (!b || !dispSt || dispSt.err === 'no display configured') return;
  const on = dispSt.asleep == null ? null : !dispSt.asleep;
  b.classList.toggle('dispOn', on === true); b.classList.toggle('dispOff', on === false); b.classList.toggle('dispWarn', !!dispSt.warning);
  const el = $('#disp'); if (!el) return;
  const st = dispBusy ? '…' : on === null ? '?' : on ? 'ON' : 'OFF';
  const html = `<button class="vbtn dbtn${on === false ? ' off' : ''}${dispSt.warning ? ' warn' : ''}"><b>Display ${st}</b></button>`;
  if (el._h !== html) { el.innerHTML = html; el._h = html; el.querySelector('button').onclick = toggleDisp; }
  el.classList.remove('hidden');
}
async function toggleDisp() {
  if (dispBusy || !dispSt) return; const want = dispSt.asleep !== false;
  if (!want && dispSt.warning) return toast(`${dispSt.label}: ${dispSt.warning}`);
  dispBusy = true; toast(`${dispSt.label}: turning ${want ? 'ON' : 'OFF'}…`);
  const r = await api('/api/display', { on: want, from: 'iPhone' }).catch(e => ({ ok: false, err: e.message }));
  dispBusy = false; if (r && r.label && typeof r.asleep === 'boolean') dispSt = r; paintDisp();
  toast(r && r.ok !== false && typeof r.asleep === 'boolean' ? `${dispSt.label} ${r.asleep ? 'OFF' : 'ON'}` : `${(dispSt && dispSt.label) || 'Display'}: ${(r && (r.err || r.warning)) || 'no answer'}`);
}
function loadDisp() { if (document.hidden || dispBusy) return; api('/api/display').then(r => { dispSt = r; paintDisp(); }).catch(() => { }); }
loadDisp(); setInterval(loadDisp, 15000);
// switches with "place": "top" (switches.js): a button in the top row, "<short> ON · <last success HH:MM>"
function renderTopSw(list) {
  const el = $('#topSw'); if (!el) return; list = (list || []).filter(w => w.place === 'top');
  const hm = t => t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '';
  const html = list.map(w => `<button class="vbtn swtop${w.enabled ? '' : ' off'}" data-id="${esc(w.id)}"><b>${esc((w.short || w.label) + ' ' + (w.offline ? '?' : w.enabled ? 'ON' : 'OFF') + (w.lastOk ? ' · ' + hm(w.lastOk) : ''))}</b></button>`).join('');
  if (el.innerHTML !== html) el.innerHTML = html;
  el.classList.toggle('hidden', !list.length);
  el.querySelectorAll('.swtop').forEach(b => b.onclick = async () => {
    const w = list.find(x => x.id === b.dataset.id); if (!w || w.offline) return; const on = !w.enabled;
    if ((w.confirm === 'both' || (w.confirm === 'off' && !on)) && !confirm(on ? (w.confirmOn || `Turn ${w.label} on?`) : (w.confirmOff || `Turn ${w.label} off?`))) return;
    const r = await api('/api/switches', { id: w.id, enabled: on, from: 'iPhone' }).catch(e => ({ ok: false, err: e.message }));
    toast(r && r.ok ? `${w.label}: ${on ? 'ON' : 'OFF'}` : `Couldn't switch: ${(r && r.err) || 'no answer'}`); loadTopSw();
  });
}
function loadTopSw() { if (document.hidden) return; fetch(`/api/switches?t=${encodeURIComponent(TOKEN)}`).then(r => r.json()).then(renderTopSw).catch(() => { }); }
loadTopSw(); setInterval(loadTopSw, 20000);
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2400); }
function offline(msg) { const o = $('#offline'); if (msg) { const h = `<div class="offBox">${msg}</div>`; if (o.innerHTML !== h) o.innerHTML = h; o.classList.remove('hidden'); } else o.classList.add('hidden'); }

// ---------- mesh (cap pixel density at 2× to keep the phone cool) ----------
const realDPR = window.devicePixelRatio || 1;
Object.defineProperty(window, 'devicePixelRatio', { get: () => Math.min(2, realDPR) });
let snap = { sessions: [], models: [], agents: [] }, selected = null, openTab = 'mesh';
// which machine serves this page: the Mac app, or the server program (server/mesh-server.js) — wording follows it
const onServer = () => !!(snap.host && snap.host.kind === 'server');
// a session running on the OTHER machine (merged in by peer.js): "on Mac" / "on server", greyed when offline
const PEERTAG = s => s.viewPeer ? ` · <b class="peerTag">on ${esc(s.hostLabel)} · ${esc(s.offline ? 'offline' : s.jobStatus || 'job')}</b>` : s.onPeer ? ` · <b class="peerTag">on ${s.hostKind === 'mac' ? 'Mac' : 'server'}${s.offline ? ' (offline)' : ''}</b>` : '';
const HOSTN = () => onServer() ? 'the server' : 'your Mac', INAPP = () => onServer() ? 'tmux' : 'in-app', TERMN = () => onServer() ? 'shell' : 'Terminal.app';
// the native iPhone shell listens here: 'offline' → it tries the next paired host (Mac ↔ server)
const native = msg => { try { webkit.messageHandlers.mesh.postMessage(msg); } catch { } };
const viz = new Mesh($('#mesh'), { onSelect: sid => sid && tapSession(sid), onHub: () => openStarSheet() });
// the black hole (blackhole.js): same rules as the Mac app
viz.onTrash = (sid, phase) => {
  const s = snap.sessions.find(q => q.sid === sid);
  if (phase === 'refuse') return toast('Groups can\'t go in the black hole');
  if (!s) return phase === 'check' ? 'gone' : undefined;
  if (phase === 'check') { if (!s.viewPeer && !s.offline && (s.owner || (s.tty && s.kind !== 'bg') || s.onPeer)) return true; toast(`${s.name} is view-only`); return false; }
  if (phase === 'send') return api('/api/send', { sid: s.sid, text: '/exit' }).then(r => toast(r.ok === false || r.out === 'notfound' ? 'Failed' : `/exit → ${s.name}`));
  if (phase === 'stuck') toast(`${s.name} didn't exit`);
};
viz.lite = true;   // iPhone: lighter renderer (renderer/*.js `lite`) — fewer pixels and frames, bubbles kept apart, one-line tags
viz.wheelZoom = e => e.preventDefault();
if (innerWidth < 700) { viz.cam.ts = viz.cam.s = .66; viz.clampCam(); viz.cam.tx = viz.cam.ttx; viz.cam.ty = viz.cam.tty; }
setTimeout(() => { $('#hint').style.opacity = 0; }, 6000);

// touch (iPhone, 2026-11-01): look around only — one finger pans, two fingers pinch-zoom and pan, a tap opens a
// session (press and hold: what it does), a tap on the sun opens Broadcast, a tap on a portal opens its group.
// No dragging bubbles, hauling probes, turning the Endurance or spinning the system on the phone: lighter and no
// half-finished drags.
const cv = $('#mesh');
let T = null, holdT = null;
const pt = t => ({ clientX: t.clientX, clientY: t.clientY });
const mid = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2, d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) });
const startPan = (p, hit) => { const c = viz.cam; return { mode: 'one', x0: p.clientX, y0: p.clientY, tx: c.ttx, ty: c.tty, hit, moved: false }; };
const startPinch = e => { const c = viz.cam, r = cv.getBoundingClientRect(), m = mid(pt(e.touches[0]), pt(e.touches[1]));
  return { mode: 'pinch', d0: m.d || 1, s0: c.ts, mx: m.x - r.left, my: m.y - r.top, tx: c.ttx, ty: c.tty, moved: true }; };
cv.addEventListener('touchstart', e => {
  e.preventDefault(); viz.lastInput = performance.now();
  const ae = document.activeElement;   // a focused terminal/textarea keeps the keyboard (and a scrolled layout) alive — drop it
  if (ae && ae !== document.body && /^(TEXTAREA|INPUT)$/.test(ae.tagName)) { ae.blur(); resetScroll(); }
  clearTimeout(holdT);
  if (e.touches.length === 1) {
    const p = pt(e.touches[0]), h = viz.hit(p);
    T = startPan(p, h);
    if (h === 'hub' && viz.sunNode && viz.sunNode()) holdT = setTimeout(() => { if (T && !T.moved && T.hit === 'hub') { T.held = true; navigator.vibrate && navigator.vibrate(10); openStarSheet(); } }, 520);   // the sun: tap = its session, hold = star menu
    if (h && h !== 'hub' && !h.startsWith('grp:')) holdT = setTimeout(() => { if (T && !T.moved && T.hit === h) { T.held = true; navigator.vibrate && navigator.vibrate(10); openDetails(h); } }, 520);
  } else if (e.touches.length >= 2) T = startPinch(e);
}, { passive: false });
cv.addEventListener('touchmove', e => {
  e.preventDefault(); viz.lastInput = performance.now(); if (!T) return;
  const c = viz.cam;
  if (T.mode === 'pinch') {
    if (e.touches.length < 2) return;
    const r = cv.getBoundingClientRect(), m = mid(pt(e.touches[0]), pt(e.touches[1]));
    const s = Math.min(2, Math.max(.65, T.s0 * m.d / T.d0)), mx = m.x - r.left, my = m.y - r.top;
    c.ttx = mx - (T.mx - T.tx) * s / T.s0; c.tty = my - (T.my - T.ty) * s / T.s0; c.ts = s;   // zoom about the fingers and follow them
    viz.clampCam(); c.s = c.ts; c.tx = c.ttx; c.ty = c.tty; return;
  }
  const p = pt(e.touches[0]);
  if (!T.moved && Math.hypot(p.clientX - T.x0, p.clientY - T.y0) > 8) { clearTimeout(holdT); T.moved = true; if (T.held) { T.held = false; closeSheet(); } }
  if (!T.moved) return;
  c.ttx = T.tx + p.clientX - T.x0; c.tty = T.ty + p.clientY - T.y0; viz.clampCam(); c.tx = c.ttx; c.ty = c.tty;
}, { passive: false });
cv.addEventListener('touchend', e => {
  e.preventDefault(); clearTimeout(holdT); if (!T) return;
  if (T.mode === 'pinch') {   // one finger left after a pinch: keep panning from where it is, never jump
    T = e.touches.length === 1 ? Object.assign(startPan(pt(e.touches[0]), null), { moved: true }) : e.touches.length >= 2 ? startPinch(e) : null; return;
  }
  if (e.touches.length) return;
  if (!T.moved && !T.held) { if (T.hit === 'hub') { if (viz.sunNode && viz.sunNode()) tapSession(viz.sunSid); else openStarSheet(); } else if (T.hit && T.hit.startsWith('grp:')) viz.toggleGroup(T.hit.slice(4)); else if (T.hit) tapSession(T.hit); }
  T = null;
}, { passive: false });
// iOS cancels touches when the keyboard, a sheet or a system gesture takes over — never leave a gesture half-open
cv.addEventListener('touchcancel', () => { clearTimeout(holdT); T = null; });
// after typing, iOS can leave the page scrolled: the mesh is drawn in place but touches land on the wrong layer
function resetScroll() { const go = () => { scrollTo(0, 0); document.documentElement.scrollTop = document.body.scrollTop = 0; viz.resize(); };
  go(); setTimeout(go, 120); setTimeout(go, 400); }

// ---------- live data ----------
let es = null, lastMsg = 0, offlineTold = false, connAt = Date.now();
function connect() {
  if (!TOKEN) return offline('Not paired yet.<br>On your Mac open <b>' + APP_NAME + ' → the phone button</b> and scan the QR code.');
  es && es.close(); connAt = Date.now();
  es = new EventSource('/api/events?t=' + encodeURIComponent(TOKEN));
  es.addEventListener('alert', ev => { try { const a = JSON.parse(ev.data); toast(`${a.title}: ${a.body}`); } catch { } });
  es.addEventListener('telemetry', ev => {
    lastMsg = Date.now(); offline(); $('#conn').classList.add('on');
    snap = JSON.parse(ev.data); viz.update(snap); render(); offlineTold = false;
    const tag = $('#hostTag'); tag.textContent = onServer() ? 'SERVER' : 'MAC'; tag.classList.toggle('hidden', !onServer());
  });
  es.onerror = () => { $('#conn').classList.remove('on'); };
}
const bootAt = Date.now(); let denied = false;
// opening the app (or coming back to it): until fresh data arrives, say so instead of showing an empty or stale screen
function connectingTick() {
  if (denied || document.hidden || !TOKEN) return;
  if (lastMsg < connAt && Date.now() - connAt > 400 && Date.now() - connAt <= 8000) { $('#conn').classList.remove('on'); offline(`<div class="spin"></div>Connecting to ${HOSTN()}…`); }
}
setInterval(connectingTick, 250);
setInterval(() => {
  if (denied) return;
  const seen = Math.max(lastMsg, connAt) || bootAt, away = document.hidden; if (away) return;
  if (Date.now() - seen > 8000) {
    $('#conn').classList.remove('on');
    offline(`<b class="offT">Can’t reach ${HOSTN()}.</b><span style="font-size:13px">${onServer() ? 'Is the server on and on Tailscale?' : `Is ${APP_NAME} open and awake, with phone access on?`} Away from home, turn on Tailscale on this phone.</span>`);
    if (!offlineTold && Date.now() - seen > 20000) { offlineTold = true; native('offline'); }
    if (!es || es.readyState === 2) connect();
  }
}, 3000);
// nothing stays connected while the page is out of sight, and it's live again the moment you come back
document.addEventListener('visibilitychange', () => { if (document.hidden) { if (es) { es.close(); es = null; } } else if (!denied) { connect(); viz.wake(); } });
connect();     // (live data doesn't wait for the history below, which can take a while)
fetch('/api/history?t=' + encodeURIComponent(TOKEN)).then(r => { if (r.status === 401) { denied = true; if (es) es.close(); offline('This pairing key is no longer valid.<br>Scan the QR code in <b>' + APP_NAME + ' → the phone button</b> again.'); } }).catch(() => { });
document.addEventListener('visibilitychange', () => { if (!document.hidden && (!es || es.readyState !== 1)) connect(); });

function render() {
  $('#today').textContent = snap.usageSum ? `Week ${fmtTok(snap.usageSum.week)}${snap.usageSum.top ? ` · top: ${snap.usageSum.top}` : ''}` : 'Token usage';
  renderVnc(snap);
  if (sheetKind === 'sessions') renderSessions();
  if (view === 'split') renderSplit();
  if (view === 'grid') renderGrid();
  if (document.body.classList.contains('navOpen')) renderDrawer();
  if (selected && !$('#sheet').classList.contains('hidden') && sheetKind === 'session') renderSession();
}

// ---------- sheets ----------
let sheetKind = null;
function sheet(kind, html, full) {
  sheetKind = kind; $('#sheetBody').innerHTML = html;
  $('#sheet').classList.toggle('full', !!full); $('#sheet').classList.remove('hidden');
  const x = $('#sheetBody .x'); if (x) x.onclick = closeSheet;
}
function closeSheet() {
  const wasTerm = sheetKind === 'term';
  $('#sheet').classList.add('hidden'); sheetKind = null; selected = null; viz.selected = view === 'split' ? splitSid : null; setTab(view, true);
  if (wasTerm && view === 'split') renderSplit(true);               // the pane gets the live terminal back
}
// swipe the sheet down to close
{ let y0 = null; const sh = $('#sheet');
  sh.addEventListener('touchstart', e => { y0 = $('#sheetBody').scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  sh.addEventListener('touchend', e => { if (y0 != null && e.changedTouches[0].clientY - y0 > 90 && sheetKind !== 'term') closeSheet(); y0 = null; }, { passive: true }); }

function setTab(t, quiet) {
  openTab = t;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  if (quiet) return;
  if (t === 'mesh') { if (sheetKind) closeSheet(); setView(t); }
  if (t === 'split' || t === 'grid') { if (sheetKind) closeSheet(); if (view !== t) Pager.go(t); else setView(t); }
  if (t === 'sessions') renderSessions(true);
  if (t === 'history') openHistory();
  if (t === 'term' && termId) openTerminal(termId);
}
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));

// a session's profile picture (renderer/avatars.js): the picked picture or GIF, else its initial on the session's colour,
// as a rounded square (phone.css .pav) — in the drawer, the Sessions list, the grid cards and the session header
const AV = (s, cls, size = 256) => window.meshAvatars ? window.meshAvatars.html(s, { cls, size, letter: true }) : '';
// ---------- sessions list ----------
const subsOpen = new Set();                                              // main sessions whose sub-sessions are unfolded (folded by default)
function renderSessions(open) {
  const S = snap.sessions, A = snap.agents || [], live = new Set(S.map(s => s.sid)), subs = new Map();
  for (const s of S) if (s.parent && live.has(s.parent)) { if (!subs.has(s.parent)) subs.set(s.parent, []); subs.get(s.parent).push(s); }
  const row = (s, cls = '') => `<div class="item${cls}" data-sid="${s.sid}">${AV(s, 'pav')}<span class="dot ${s.health}"></span><div class="t"><div class="n">${esc(s.name)}${SUNTAG(s)}</div>
      <div class="m">${esc((s.model || '—').replace('claude-', ''))} · ${fmtTok(s.todayTok)} · ${s.health === 'working' ? Math.round(s.tps) + ' tok/s' : s.health + ' · ' + ago(s.sinceUse ?? s.sinceWrite) + ' ago'}${RELAYS(s)}${s.owner ? ' · ' + INAPP() : ''}${PEERTAG(s)}${pcBadges(s.sid)}</div>${cls ? '' : pcIntro(s.sid)}</div>›</div>`;
  const tree = s => { const k = subs.get(s.sid); if (!k) return row(s); const on = subsOpen.has(s.sid);
    return row(s) + `<div class="subtog" data-sub="${s.sid}">${on ? '▾' : '▸'} ${k.length} sub-session${k.length > 1 ? 's' : ''}</div>` + (on ? k.map(x => row(x, ' insub')).join('') : ''); };
  const html = `<div class="sh-h"><h2>Sessions · ${S.length}</h2><button class="x">×</button></div>` +
    (S.filter(s => !(s.parent && live.has(s.parent))).map(tree).join('') || `<div class="m" style="padding:14px 4px;color:var(--dim)">${snap.ready ? 'No Claude Code sessions running.' : 'Connecting…'}</div>`) +
    (A.length ? `<h3>Agents</h3>` + A.map(a => `<div class="item"><span class="dot ${a.state === 'running' ? 'working' : 'waiting'}"></span><div class="t"><div class="n">${esc(a.name || a.id)}</div><div class="m">${esc(a.state || '')}</div></div></div>`).join('') : '');
  if (open || sheetKind === 'sessions') { sheet('sessions', html); document.querySelectorAll('#sheetBody .item[data-sid]').forEach(el => el.onclick = () => openSession(el.dataset.sid));
    document.querySelectorAll('#sheetBody .subtog').forEach(el => el.onclick = () => { const k = el.dataset.sub; if (subsOpen.has(k)) subsOpen.delete(k); else subsOpen.add(k); renderSessions(); }); }
}

// ---------- one session ----------
const QUICK = ['/compact', '/context', '/cost', '/model', '/doctor', '/skills', '/todos', '/status'];
const cur = () => snap.sessions.find(s => s.sid === selected);
function openSession(sid) { selected = sid; viz.selected = sid; openTab = 'sessions'; sheetKind = 'session'; renderSession(true); }
function renderSession(first) {
  const s = cur();
  if (!s) { if (first) sheet('session', `<div class="sh-h"><h2>Session ended</h2><button class="x">×</button></div>`); return; }
  if (s.viewPeer) return renderViewSession(s);
  if (s.onPeer && s.offline) {
    const where = s.hostKind === 'mac' ? 'your Mac' : 'the server';
    sheet('session', `<div class="sh-h"><span class="dot offline"></span><h2>${esc(s.name)}</h2><button class="x">×</button></div>
      <div class="meta"><span>${esc(s.model || '')}</span><span>${esc((s.cwd || '').replace(/^\/(Users|home)\/[^/]+/, '~'))}</span></div>
      <p class="m" style="margin:10px 0">This session runs on ${where}, which is offline right now. Continue the same conversation here on ${HOSTN()}?</p>
      <div class="row"><button class="primary" id="sHere">Resume here</button></div>`);
    $('#sHere').onclick = async () => { const r = await api('/api/resume', { sid: s.sid }); toast(r.ok === false ? `Couldn't resume — its history hasn't reached ${HOSTN()} yet` : `Resuming on ${HOSTN()}…`); closeSheet(); };
    return;
  }
  const can = !!(s.owner || (s.tty && s.kind !== 'bg')), col = FAMILY_COLOR[s.family] || '#9fb4d8', pct = s.ctxMax ? s.ctx / s.ctxMax * 100 : 0;
  const stats = `<div class="meta"><span style="color:${col}">${esc(s.model || 'no model yet')}</span><span style="color:${HEALTH_COLOR[s.health]}">${esc(s.health)}</span><span>${s.owner ? INAPP() : s.kind === 'bg' ? 'background' : TERMN()}</span><span>${esc((s.cwd || '').replace(/^\/Users\/[^/]+/, '~'))}</span>${s.onPeer ? `<span class="peerTag">on ${s.hostKind === 'mac' ? 'Mac' : 'server'}</span>` : ''}</div>
    <div class="kpis"><div class="kpi"><div class="l">Speed</div><div class="v">${Math.round(s.tps)}<small> t/s</small></div></div>
      <div class="kpi"><div class="l">Today</div><div class="v">${fmtTok(s.todayTok)}</div></div><div class="kpi"><div class="l">Session</div><div class="v">${fmtTok(s.totalTok)}</div></div></div>
    <div class="meta" style="justify-content:space-between;margin:0"><span>Context</span><span>${Math.round(pct)}%</span></div>
    <div class="bar"><div style="width:${Math.min(100, pct)}%;background:${pct > 85 ? 'var(--err)' : pct > 60 ? 'var(--warn)' : col}"></div></div>`;
  const log = `<h3>Activity</h3><div class="log">${s.log.slice(-10).reverse().map(l => `<div class="${l.kind}">${l.kind === 'tool' ? ICON.gear + ' ' : l.kind === 'you' ? '› ' : ''}${esc(l.text)}</div>`).join('') || '<div>—</div>'}</div>`;
  if (!first && sheetKind === 'session' && $('#sStats')) { $('#sStats').innerHTML = stats; $('#sLog').innerHTML = log; $('#sName').textContent = s.name; return; }
  sheet('session', `<div class="sh-h"><span class="dot ${s.health}"></span><h2 id="sName">${esc(s.name)}</h2><button class="x">×</button></div>
    <div id="sStats">${stats}</div>
    ${pcBox(s.sid)}
    ${can ? `<textarea id="sText" rows="3" placeholder="Message ${esc(s.name)}…"></textarea>
    <div class="row"><button class="primary" id="sSend">Send</button><button id="sAtt">${ICON.plus} Attach</button><button id="sInt">Interrupt</button>${s.owner ? '<button id="sTerm">Open terminal</button>' : ''}</div>
    <div class="chips">${QUICK.map(c => `<button data-c="${c}">${c}</button>`).join('')}<button id="sMore">More…</button></div>` : '<div class="meta">Background session — view only.</div>'}
    <div class="row"><button id="sLive">◉ Live</button><button id="sRen">${ICON.pencil} Rename</button><button id="sAg">${ICON.gear} Convert to agent</button></div>
    ${snap.peer && snap.peer.online && s.kind !== 'bg' && !s.offline ? `<div class="row"><button id="sMove">⇄ Move to ${esc(s.onPeer ? 'this Mac' : snap.peer.label)}</button></div>` : ''}
    <div id="sLog">${log}</div>`);
  pcWire();
  { const b = $('#sLive'); if (b) b.onclick = () => openLive(s.sid); }
  if (can) {
    $('#sSend').onclick = async () => { const v = $('#sText').value.trim(); if (!v) return; const r = await api('/api/send', { sid: s.sid, text: v }); if (r.ok === false || r.out === 'notfound') return toast('Send failed' + (r.err ? ': ' + r.err : '')); $('#sText').value = ''; toast('Sent'); };
    $('#sInt').onclick = async () => { await api('/api/interrupt', { sid: s.sid }); toast('Interrupt sent'); };
    $('#sAtt').onclick = () => attachInto($('#sText'), { sid: s.sid });
    document.querySelectorAll('#sheetBody [data-c]').forEach(b => b.onclick = () => runCmd(s, b.dataset.c));
    $('#sMore').onclick = () => openCommands(s);
    const tb = $('#sTerm'); if (tb) tb.onclick = () => openTerminal(s.owner, s.sid);
  }
  $('#sRen').onclick = async () => { const n = prompt('Rename session', s.name); if (n && n.trim()) { const r = await api('/api/rename', { sid: s.sid, name: n.trim() }); toast(r.ok === false ? 'Rename failed' : 'Renamed'); } };
  if ($('#sMove')) $('#sMove').onclick = async () => {   // stop it on its Mac, copy it to the other one, resume it there
    if (!confirm(`Move "${s.name}" to the other Mac? It stops where it runs now and resumes there.`)) return;
    toast('Moving… (a big session takes a minute)'); const r = await api('/api/handoff/move', { sid: s.remoteSid || s.sid });
    toast(r && r.ok ? `Now running on ${r.to}` : `Couldn't move: ${(r && r.err) || 'failed'}${r && r.restartedHere ? ' (restarted where it was)' : ''}`); closeSheet();
  };
  $('#sAg').onclick = async () => {
    if (!confirm(`Continue "${s.name}" as a background agent on ${HOSTN()}?` + (s.owner && !onServer() ? '\n(its in-app terminal will close)' : (s.tty || s.owner) ? '\n(a copy starts; the running one keeps going)' : ''))) return;
    const task = prompt('Task for the agent (optional)', '') || '';
    toast('Starting agent…'); const r = await api('/api/convert', { sid: s.sid, task }); toast(r.ok ? 'Agent started' : 'Convert failed');
  };
}
// a job on a view-only machine (view-peers.js): send a prompt or stop it while it runs; nothing else
function renderViewSession(s) {
  const col = FAMILY_COLOR[s.family] || '#9fb4d8';
  const meta = `<div class="meta"><span style="color:${col}">${esc(s.model || 'no model yet')}</span><span style="color:${HEALTH_COLOR[s.health] || '#999'}">${esc(s.offline ? 'offline' : s.jobStatus || s.health)}</span><span>${s.turns || 0} turns${s.jobCost ? ' · $' + s.jobCost.toFixed(2) : ''}</span><span class="peerTag">on ${esc(s.hostLabel)}</span></div>`;
  if (sheetKind === 'session' && $('#vStats') && $('#vStats').dataset.sid === s.sid) { $('#vStats').innerHTML = meta + (s.last ? `<p class="m">${esc(s.last)}</p>` : ''); return; }
  sheet('session', `<div class="sh-h"><span class="dot ${s.health}"></span><h2>${esc(s.name)}</h2><button class="x">×</button></div>
    <div id="vStats" data-sid="${esc(s.sid)}">${meta}${s.last ? `<p class="m">${esc(s.last)}</p>` : ''}</div>
    ${s.canSend ? `<textarea id="sText" rows="3" placeholder="Message ${esc(s.name)}…"></textarea>
    <div class="row"><button class="primary" id="sSend">Send</button><button id="sInt">Stop job</button></div>` : '<div class="meta">Send and stop work only while the job runs.</div>'}
    <div class="meta">${esc(s.hostLabel)} is a view-only machine: no terminal, no transcript, no resume.</div>`);
  if (!s.canSend) return;
  $('#sSend').onclick = async () => { const v = $('#sText').value.trim(); if (!v) return; const r = await api('/api/send', { sid: s.sid, text: v }); if (r.ok === false) return toast('Send failed' + (r.err ? ': ' + r.err : '')); $('#sText').value = ''; toast('Sent'); };
  $('#sInt').onclick = async () => { if (!confirm(`Stop the job ${s.name}?`)) return; const r = await api('/api/interrupt', { sid: s.sid }); toast(r.ok === false ? 'Stop failed' + (r.err ? ': ' + r.err : '') : 'Stop sent'); };
}
async function runCmd(s, cmd) {
  if (/^\/(clear|exit)$/.test(cmd) && !confirm(`Run ${cmd} in ${s.name}? This can't be undone.`)) return;
  const r = await api('/api/send', { sid: s.sid, text: cmd });
  toast(r.ok === false || r.out === 'notfound' ? 'Failed' : `${cmd} → ${s.name}`);
}
const ALL_BUILTIN = ['/compact', '/clear', '/context', '/cost', '/usage', '/status', '/todos', '/doctor', '/help', '/model', '/skills', '/agents', '/mcp', '/memory', '/config', '/permissions', '/hooks', '/init', '/review', '/release-notes', '/export', '/rewind', '/resume', '/remote-control', '/exit'];
async function openCommands(s) {
  const mine = await api('/api/commands?cwd=' + encodeURIComponent(s.cwd || ''));
  const list = ALL_BUILTIN.map(c => ({ cmd: c, desc: '' })).concat(Array.isArray(mine) ? mine : []);
  sheet('cmds', `<div class="sh-h"><h2>Commands</h2><button class="x">×</button></div><input id="cq" placeholder="Filter…">
    <div id="cl"></div>`, true);
  const draw = () => { const q = $('#cq').value.toLowerCase().replace(/^\//, ''); $('#cl').innerHTML = list.filter(c => !q || c.cmd.includes(q) || (c.desc || '').toLowerCase().includes(q))
    .map(c => `<div class="item" data-c="${esc(c.cmd)}"><div class="t"><div class="n">${esc(c.cmd)}</div>${c.desc ? `<div class="m">${esc(c.desc)}</div>` : ''}</div></div>`).join('');
    document.querySelectorAll('#cl .item').forEach(el => el.onclick = () => { runCmd(s, el.dataset.c); openSession(s.sid); }); };
  $('#cq').oninput = draw; draw();
}

// ---------- the mother star's menu, token usage ----------
function openStarSheet() {
  sheet('star', `<div class="sh-h"><h2>Mother star</h2><button class="x">×</button></div><div class="item" id="sBc"><div class="t"><div class="n">Broadcast</div></div>›</div><div class="item" id="sUse"><div class="t"><div class="n">Token usage</div></div>›</div>`);
  $('#sBc').onclick = () => openBroadcast(); $('#sUse').onclick = () => openUsage();
  // mode switches (switches.js): state + who/when; every flip asks first, nothing is written on 취소
  fetch(`/api/switches?t=${encodeURIComponent(TOKEN)}`).then(r => r.json()).then(list => {
    if (sheetKind !== 'star' || !Array.isArray(list)) return;
    for (const w of list) {
      const el = document.createElement('div'); el.className = 'item';
      const when = w.at ? new Date(w.at).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      el.innerHTML = `<div class="t"><div class="n">${esc(w.label)}</div><div class="m">${w.offline ? esc(w.err || 'other Mac not answering') : w.at ? `${esc(w.from || w.by || '')} · ${esc(when)}` : 'never switched on'}</div></div><b style="color:${w.enabled ? '#ff6b6b' : '#999'}">${w.offline ? '?' : w.enabled ? 'ON' : 'OFF'}</b>`;
      if (!w.offline) el.onclick = () => askSwitch(w);
      $('#sheetBody').appendChild(el);
      if (!w.offline && w.intervals && w.intervals.length) {           // how often it checks: no popup, it doesn't change what it may do
        const cur = (w.intervals.find(i => i.sec === w.interval) || {}).label || (w.interval ? w.interval + ' s' : '?');
        const iv = document.createElement('div'); iv.className = 'item';
        iv.innerHTML = `<div class="t"><div class="n">${esc(w.label)} · check every</div><div class="m">${esc(cur)}</div></div>›`;
        iv.onclick = () => pickInterval(w); $('#sheetBody').appendChild(iv);
      }
    }
  }).catch(() => { });
}
function pickInterval(w) {
  sheet('swiv', `<div class="sh-h"><h2>${esc(w.label)} · check every</h2><button class="x">×</button></div>` +
    w.intervals.map(i => `<div class="item" data-sec="${i.sec}"><div class="t"><div class="n">${esc(i.label)}</div></div>${i.sec === w.interval ? ICON.check : ''}</div>`).join(''));
  $('#sheetBody').querySelectorAll('[data-sec]').forEach(el => el.onclick = async () => {
    const r = await api('/api/switches', { id: w.id, interval: +el.dataset.sec, from: 'iPhone' }).catch(e => ({ ok: false, err: e.message }));
    toast(r && r.ok ? `${w.label}: checking now, then every ${el.querySelector(".n").textContent}` : `Couldn't change it: ${(r && r.err) || 'no answer'}`); openStarSheet();
  });
}
function askSwitch(w) {
  const on = !w.enabled, msg = on ? (w.confirmOn || `Turn ${w.label} on?`) : (w.confirmOff || `Turn ${w.label} off?`);
  sheet('swask', `<div class="sh-h"><h2>${esc(w.label)}</h2><button class="x">×</button></div><div class="meta" style="white-space:pre-wrap">${esc(msg)}</div>
    <div class="row"><button id="swNo" class="primary">취소</button><button id="swYes" style="${on ? 'color:#ff6b6b' : ''}">${esc(on ? (w.onLabel || '켜기') : (w.offLabel || '끄기'))}</button></div>`);
  $('#swNo').onclick = () => openStarSheet();
  $('#swYes').onclick = async () => {
    $('#swYes').disabled = true;
    const r = await api('/api/switches', { id: w.id, enabled: on, from: 'iPhone' }).catch(e => ({ ok: false, err: e.message }));
    toast(r && r.ok ? `${w.label}: ${r.state.enabled ? 'ON' : 'OFF'}` : `Couldn't switch: ${(r && r.err) || 'no answer'}`); openStarSheet();
  };
}
function openUsage() {
  window.usageView.open({ box: html => { const b = $('#sheetBody'), st = sheetKind === 'usage' && b ? b.scrollTop : 0; sheet('usage', `<div class="sh-h"><span class="spacer"></span><button class="x">×</button></div>${html}`, true); if (st) $('#sheetBody').scrollTop = st; },
    get: () => fetch(`/api/usage?t=${encodeURIComponent(TOKEN)}`).then(r => r.json()), session: list => api('/api/usage/session', { list }), setManual: pct => api('/api/usage/manual', { pct }) });
}
// ---------- broadcast ----------
function openBroadcast() {
  const ctl = snap.sessions.filter(s => s.owner || (s.tty && s.kind !== 'bg'));
  sheet('bc', `<div class="sh-h"><h2>Broadcast</h2><button class="x">×</button></div>
    <div class="meta">Send one message to every session you can control (${ctl.length}).</div>
    <textarea id="bText" rows="4" placeholder="Message all sessions…"></textarea><div class="row"><button class="primary" id="bGo">Send to ${ctl.length}</button></div>`);
  $('#bGo').onclick = async () => {
    const v = $('#bText').value.trim(); if (!v || !ctl.length || !confirm(`Send to ${ctl.length} sessions?`)) return;
    await Promise.all(ctl.map(s => api('/api/send', { sid: s.sid, text: v }))); toast('Broadcast sent'); closeSheet();
  };
}

// ---------- all sessions (resume on the Mac) ----------
let hist = [];
async function openHistory() {
  sheet('history', `<div class="sh-h"><h2>All sessions</h2><button class="x">×</button></div><input id="hq" placeholder="Search…"><div id="hl"><div class="meta" style="padding:12px 0">Loading…</div></div>`, true);
  try { hist = await api('/api/history'); } catch { hist = null; }
  if (!Array.isArray(hist)) { hist = []; if ($('#hl')) $('#hl').innerHTML = '<div class="meta" style="padding:12px 0">Couldn\'t load sessions. Close this and open it again to retry.</div>'; return; }
  const live = new Set(snap.sessions.map(s => s.sid)), title = h => h.title || h.aiTitle || h.first || h.last || h.sid.slice(0, 8);
  const draw = () => {
    const q = $('#hq').value.toLowerCase();
    $('#hl').innerHTML = hist.filter(h => h.entry !== 'sdk-cli' && (!q || [h.title, h.aiTitle, h.first, h.cwd].some(v => v && v.toLowerCase().includes(q)))).slice(0, 120)
      .map(h => `<div class="item" data-h="${h.sid}"><div class="t"><div class="n">${esc(title(h))}</div><div class="m">${esc((h.cwd || '').split('/').pop() || '~')} · ${ago((Date.now() - h.mtime) / 1000)}</div></div>${live.has(h.sid) ? '<span class="tag live">live</span>' : ''}</div>`).join('');
    document.querySelectorAll('#hl .item').forEach(el => el.onclick = async () => {
      const sid = el.dataset.h;
      if (live.has(sid)) return openSession(sid);
      if (!confirm(`Resume "${title(hist.find(h => h.sid === sid))}" on ${HOSTN()}?`)) return;
      const r = await api('/api/resume', { sid }); if (r.ok === false) return toast(`${HOSTN()} didn’t respond`);
      toast(`Resuming on ${HOSTN()}…`);
      const t0 = Date.now(), iv = setInterval(() => { if (snap.sessions.some(s => s.sid === sid)) { clearInterval(iv); openSession(sid); } else if (Date.now() - t0 > 25000) clearInterval(iv); }, 700);
    });
  };
  $('#hq').oninput = draw; draw();
}

// ---------- terminal of an in-app session (one live stream at a time: full-screen sheet or the Split pane) ----------
let termId = null, term = null, tes = null;
const KEYS = [['Esc', '\x1b'], ['Tab', '\t'], ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['←', '\x1b[D'], ['→', '\x1b[C'], ['⏎', '\r'], ['^C', '\x03'], ['⇧Tab', '\x1b[Z']];
const termControls = () => `<div class="keys">${KEYS.map(([l, k]) => `<button data-k="${encodeURIComponent(k)}">${l}</button>`).join('')}</div>
    <div class="tin"><input class="tIn" placeholder="Type, then Send (adds Enter)" autocapitalize="off" autocorrect="off" enterkeyhint="send"><button class="tAtt" aria-label="Attach a photo or file">${ICON.plus}</button><button class="primary tGo" aria-label="Send">${ICON.up}</button></div>`;
const TLH = 1.12;   // terminal line height: a little air between lines, like the Claude app's text
function mountTerm(host, id, box, sid) {
  termId = id; tes && tes.close(); if (term) { term._ro && term._ro.disconnect(); term._stamps && term._stamps.dispose(); term.dispose(); }
  term = new Terminal({ fontFamily: 'ui-monospace, "SF Mono", Menlo, "Apple Symbols", "Hiragino Sans", monospace', fontSize: 9, lineHeight: TLH, fontWeightBold: '600', letterSpacing: 0, convertEol: false, disableStdin: false, scrollback: 20000,
    theme: termTheme() });
  term.open(host); touchScroll(host);
  // a time column beside each prompt / reply (term-stamps.js; times from the session's transcript on the Mac)
  if (window.attachTermStamps && sid) term._stamps = attachTermStamps(term, host, { sid: () => sid, fetch: s => api('/api/stamps?sid=' + encodeURIComponent(s)) });
  const write = d => api('/api/term/' + encodeURIComponent(id), { data: d });
  term.onData(write);
  tes = new EventSource('/api/term/' + encodeURIComponent(id) + '?t=' + encodeURIComponent(TOKEN));
  // the terminal keeps the Mac's row count, which is often taller than the phone's box: keep the box pinned to its
  // bottom (the prompt) whenever it changes size or new output lands, unless you scrolled up to read (2026-11-01)
  host._pinned = true;
  const pin = force => { if (!force && !host._pinned) return; const m = host.scrollHeight - host.clientHeight; if (host.scrollTop < m) host.scrollTop = m; host._pinned = true; };
  host.onscroll = () => { host._pinned = host.scrollTop >= host.scrollHeight - host.clientHeight - 2; };
  if (window.ResizeObserver) { const ro = new ResizeObserver(() => pin()); ro.observe(host); const xe = host.querySelector('.xterm'); if (xe) ro.observe(xe); term._ro = ro; }
  if (term.onRender) term.onRender(() => pin());
  window.meshPinTerm = () => { if (!term) return; term.scrollToBottom(); pin(true); };
  tes.addEventListener('init', ev => {
    const i = JSON.parse(ev.data); fitTo(i.cols, i.rows); term.reset(); term.write(textGlyphs(keepHist(i.backlog)), () => pin(true));
    pin(true);
  });
  // the phone claims the session's size, as if it were running here (2026-11-16): opening it, turning the phone,
  // coming back to the app or touching the terminal resizes the session to this screen at a readable font, and Claude
  // Code redraws for it. When another device takes the size, its grid is shown scaled until the phone is used again.
  const PF = 10.5, mine = () => { const w = host.clientWidth - 10 - (term._stamps ? 40 : 0), h = host.clientHeight - 8;
    return { cols: Math.max(30, Math.floor(w / (PF * .602))), rows: Math.max(10, Math.floor(h / (PF * 1.17 * TLH))) }; };
  let lastClaim = 0;
  const claim = force => { if (!term || termId !== id || document.hidden) return; const d = mine(); if (d.cols < 30 || host.clientHeight < 60) return;
    if (!force && term.cols === d.cols && term.rows === d.rows) return; if (Date.now() - lastClaim < 800 && !force) return; lastClaim = Date.now();
    api('/api/term/' + encodeURIComponent(id), { resize: d }); };
  // always the size the host reports (a grid that differs from the host's garbles Claude's redraws): our own size at the
  // readable font, anyone else's shrunk to fit
  // 2026-11-19 (Kevin): never wider than the screen. Another device's wider grid is shrunk until it fits exactly (measured,
  // no minimum font); the session's real width is untouched. Touching the terminal still claims it at the readable size.
  const avail = () => host.clientWidth - 8 - (term._stamps ? 40 : 0);
  const shrink = () => { if (!term) return; const sc = host.querySelector('.xterm-screen'); if (!sc) return;
    for (let i = 0; i < 3; i++) { const w = sc.getBoundingClientRect().width, a = avail(); if (!w || w <= a + 0.5) break;
      term.options.fontSize = Math.max(2, Math.floor(term.options.fontSize * a / w * 100) / 100); } };
  const fitTo = (cols, rows) => { const d = mine(); term.options.fontSize = cols === d.cols ? PF : Math.min(PF, avail() / (cols * .6)); term.resize(cols, rows); shrink(); };
  if (window.ResizeObserver) { const ro3 = new ResizeObserver(() => shrink()); ro3.observe(host); }
  tes.addEventListener('size', ev => { const i = JSON.parse(ev.data); fitTo(i.cols, i.rows); });
  tes.addEventListener('init', () => setTimeout(() => claim(true), 250));
  host.addEventListener('touchstart', () => claim(), { passive: true, capture: true });
  box.addEventListener('focusin', () => claim());
  if (window.ResizeObserver) { let rt = 0; const ro2 = new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => claim(), 300); }); ro2.observe(host); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(() => claim(true), 600); });
  tes.addEventListener('data', ev => term.write(textGlyphs(keepHist(JSON.parse(ev.data)))));
  tes.addEventListener('exit', () => term.write('\r\n\x1b[90m[process exited]\x1b[0m\r\n'));
  box.querySelectorAll('.keys button').forEach(b => b.onclick = () => write(decodeURIComponent(b.dataset.k)));
  const inp = box.querySelector('.tIn'), go = () => { const v = inp.value; write(v); setTimeout(() => write('\r'), 60); inp.value = ''; };
  box.querySelector('.tGo').onclick = go; box.querySelector('.tAtt').onclick = () => attachInto(inp, { term: id }); inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
}
// Claude Code's full redraws erase the scrollback (ESC[3J) — on the phone, keep the history so you can scroll back
const keepHist = d => String(d).replace(/\x1b\[3J/g, '');
// one-finger vertical drag scrolls the terminal itself (iOS won't scroll xterm's history natively): the box first,
// then the history, with a little momentum; sideways drags still pan a wide terminal natively
function touchScroll(host) {
  if (host._ts) return; host._ts = 1;
  let y = null, x0 = 0, acc = 0, v = 0, lastT = 0, axis = null, raf = 0;
  const lh = () => { const r = host.querySelector('.xterm-rows'); return r && r.firstElementChild ? r.firstElementChild.getBoundingClientRect().height || 10 : (term ? term.options.fontSize * 1.2 : 10); };
  // one scroll: the box stays pinned to its bottom and a drag moves the history; only at the very top of the history
  // does the box itself move, to show the first rows. Coming back down: the box first, then the history (2026-11-01)
  const lines = dy => { acc += dy; const n = Math.trunc(acc / lh()); if (n) { acc -= n * lh(); term.scrollLines(-n); } };
  const by = dy => {                       // dy > 0: show older lines
    if (!term) return false;
    const b = term.buffer.active, m = host.scrollHeight - host.clientHeight;
    // a full-screen app (Claude Code) with mouse reporting scrolls itself: send it wheel events, as a Mac's trackpad does
    if (b.type === 'alternate' && term.modes.mouseTrackingMode !== 'none' && term.input) {
      acc += dy; const step = lh() * 1.5, n = Math.trunc(acc / step); if (!n) return true; acc -= n * step;
      const r = Math.max(1, Math.floor(term.rows / 2)), c = Math.max(1, Math.floor(term.cols / 2));
      term.input(`\x1b[<${n > 0 ? 64 : 65};${c};${r}M`.repeat(Math.min(6, Math.abs(n))), true); return true;
    }
    if (dy > 0) {
      if (b.viewportY > 0) { lines(dy); return true; }
      if (host.scrollTop > 0) { host.scrollTop -= dy; return true; }
      return false;
    }
    if (host.scrollTop < m - 1) { host.scrollTop = Math.min(m, host.scrollTop - dy); return true; }
    if (b.viewportY < b.baseY) { lines(dy); return true; }
    return false;
  };
  host.addEventListener('touchstart', e => { cancelAnimationFrame(raf); if (e.touches.length !== 1) { y = null; return; }
    y = e.touches[0].clientY; x0 = e.touches[0].clientX; axis = null; v = 0; acc = 0; lastT = performance.now(); }, { passive: true, capture: true });
  host.addEventListener('touchmove', e => { if (y == null || e.touches.length !== 1) return;
    const t = e.touches[0], dy = t.clientY - y;
    if (!axis) { if (Math.abs(dy) < 6 && Math.abs(t.clientX - x0) < 6) return; axis = Math.abs(dy) >= Math.abs(t.clientX - x0) ? 'y' : 'x'; }
    if (axis !== 'y') return;
    e.preventDefault(); e.stopPropagation();
    const now = performance.now(); v = dy / Math.max(8, now - lastT); lastT = now; y = t.clientY; by(dy);
  }, { passive: false, capture: true });
  host.addEventListener('touchend', () => { if (axis !== 'y') return; y = null;
    const fl = () => { v *= .94; if (Math.abs(v) < .02 || !by(v * 16)) return; raf = requestAnimationFrame(fl); };
    if (Math.abs(v) > .15) raf = requestAnimationFrame(fl); }, { capture: true });
}
let termSid = null;
function openTerminal(id, sid) {
  if (sid !== undefined) termSid = sid;
  $('#termTab').classList.remove('hidden'); setTab('term', true);
  sheet('term', `<div id="termWrap"><div class="sh-h"><h2>Terminal</h2><button class="x">×</button></div><div id="xt"></div>${termControls()}</div>`, true);
  mountTerm($('#xt'), id, $('#termWrap'), termSid);
}

// ---------- views: Mesh · Split · Grid ----------
// Split: the mesh (smaller star, one-line tags) over a session pane — portrait stacks them, landscape puts them
//   side by side. The pane is that session's live terminal when it runs inside the Mac app, otherwise its
//   controls (send, interrupt, quick commands, activity). A chip strip switches sessions; the keyboard
//   takes over the whole screen while typing.
// Grid: every live session as a card — health, speed sparkline, spend, context, latest activity — no
//   terminal streams (iOS allows ~6 connections per host), so it stays light. Tap a card → Split on it,
//   press and hold → what the session does.
let view = 'split', splitSid = localStorage.getItem('mesh.splitSid') || null, paneKind = null;
function setView(v) {
  view = v; document.body.dataset.view = v; localStorage.setItem('mesh.view', v);
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === v));
  viz.compact = v === 'split'; viz.offscreen = true;          // the phone shows no mesh animation (2026-11-15): never draw it
  viz.selected = v === 'split' ? splitSid : null;
  if (v !== 'split' && paneKind === 'term' && sheetKind !== 'term') { tes && tes.close(); paneKind = null; }
  if (v === 'split') renderSplit(true);
  if (v === 'grid') renderGrid();
  requestAnimationFrame(() => viz.resize());
}
function tapSession(sid) { if (view === 'split') pickSplit(sid); else openSession(sid); }
function pickSplit(sid) {
  splitSid = sid; localStorage.setItem('mesh.splitSid', sid); viz.selected = sid;
  if (view !== 'split') Pager.go('split'); else renderSplit(true);
}
function splitSession() {
  const S = snap.sessions;
  let s = S.find(x => x.sid === splitSid);
  if (!s) { s = S.find(x => x.owner && x.health === 'working') || S.find(x => x.owner) || S.find(x => x.health === 'working') || S[0]; if (s) { splitSid = s.sid; viz.selected = s.sid; } }
  return s;
}
function renderSplit(force) {
  const ago = x => Math.min(...[x.sinceUse, x.sinceWrite].filter(v => typeof v === 'number' && v >= 0), 9e9);   // busy first, then most recently used
  const S = [...snap.sessions].sort((a, b) => ((b.health === 'working' || b.health === 'waiting') - (a.health === 'working' || a.health === 'waiting')) || ago(a) - ago(b));
  const s = splitSession();
  $('#switch').innerHTML = S.map(x => `<button class="chip ${s && x.sid === s.sid ? 'on' : ''}" data-sid="${x.sid}"><span class="dot ${x.health}"></span><span class="cn">${esc(x.name)}</span>${x.health === 'working' ? `<small>${Math.round(x.tps)}</small>` : ''}</button>`).join('')
    || `<span class="meta" style="padding:6px 4px">${snap.ready ? 'No Claude Code sessions running.' : 'Connecting…'}</span>`;
  $('#switch').querySelectorAll('[data-sid]').forEach(b => b.onclick = () => pickSplit(b.dataset.sid));
  if (!s) { $('#pane').innerHTML = ''; paneKind = null; return; }
  const tid = s.owner || (!s.onPeer && s.pane) || null;            // a Mesh terminal, or the tmux pane the session runs in (2026-11-15)
  const kind = tid ? 'term' : 'ctl', key = kind + s.sid;
  $('#tpName').textContent = s.name; $('#tpSub').textContent = s.health === 'working' ? 'Working…' : s.onPeer ? 'on the other Mac' : (s.model || '').replace('claude-', '');
  const head = `${AV(s, 'pav hd')}<span class="dot ${s.health}"></span><b>${esc(s.name)}</b><span class="pm">${s.health === 'working' ? Math.round(s.tps) + ' tok/s · ' : ''}${fmtTok(s.todayTok)}</span>`;
  if (!force && paneKind === key) {                              // live refresh without touching the terminal or the text box
    $('#paneHead .ph').innerHTML = head;
    if (kind === 'ctl') { $('#pStats').innerHTML = paneStats(s); $('#pLog').innerHTML = paneLog(s); }
    const on = $('#switch .chip.on'); if (on && renderSplit.last !== s.sid) { renderSplit.last = s.sid; on.scrollIntoView({ inline: 'center', block: 'nearest' }); }
    return;
  }
  paneKind = key;
  $('#pane').innerHTML = `<div id="paneHead"><div class="ph">${head}</div>${kind === 'term' ? '<button id="pFull" title="Full screen" aria-label="Full screen">' + ICON.expand + '</button>' : ''}<button id="pInfo" title="Details" aria-label="Details">${ICON.info}</button></div>` +
    (kind === 'term' ? `<div id="pxt"></div>${termControls()}`
      : `<div id="pScroll"><div id="pStats">${paneStats(s)}</div>${(s.tty && s.kind !== 'bg') ? `<div class="tin"><textarea id="pText" rows="2" placeholder="Message ${esc(s.name)}…"></textarea><button id="pAtt" aria-label="Attach a photo or file">${ICON.plus}</button><button class="primary" id="pSend" aria-label="Send">${ICON.up}</button></div>
          <div class="chips"><button id="pInt">Interrupt</button>${QUICK.slice(0, 5).map(c => `<button data-c="${c}">${c}</button>`).join('')}</div>` : '<div class="meta">Background session — view only.</div>'}<div id="pLog">${paneLog(s)}</div></div>`);
  $('#pInfo').onclick = () => openSession(s.sid);
  if (kind === 'term') {
    $('#pFull').onclick = () => openTerminal(tid, s.sid);
    mountTerm($('#pxt'), tid, $('#pane'), s.sid);
  } else {
    if (termId && sheetKind !== 'term') { tes && tes.close(); }
    const send = $('#pSend');
    if (send) {
      send.onclick = async () => { const v = $('#pText').value.trim(); if (!v) return; const r = await api('/api/send', { sid: s.sid, text: v }); if (r.ok === false || r.out === 'notfound') return toast('Send failed'); $('#pText').value = ''; toast('Sent'); };
      $('#pInt').onclick = async () => { await api('/api/interrupt', { sid: s.sid }); toast('Interrupt sent'); };
      $('#pAtt').onclick = () => attachInto($('#pText'), { sid: s.sid });
      $('#pane').querySelectorAll('[data-c]').forEach(b => b.onclick = () => runCmd(s, b.dataset.c));
    }
  }
  const on = $('#switch .chip.on'); if (on) on.scrollIntoView({ block: 'nearest' });
}
const paneStats = s => { const pct = s.ctxMax ? s.ctx / s.ctxMax * 100 : 0;
  return `<div class="meta"><span style="color:${FAMILY_COLOR[s.family] || '#9fb4d8'}">${esc((s.model || '—').replace('claude-', ''))}</span><span>${s.kind === 'bg' ? 'background' : TERMN()}</span><span>context ${Math.round(pct)}%</span><span>${fmtTok(s.totalTok)} session</span></div>`; };
const paneLog = s => `<div class="log">${s.log.slice(-8).reverse().map(l => `<div class="${l.kind}">${l.kind === 'tool' ? ICON.gear + ' ' : l.kind === 'you' ? '› ' : ''}${esc(l.text)}</div>`).join('') || '<div>—</div>'}</div>`;

// sparkline as an SVG path (cheap to redraw every telemetry tick)
function sparkPath(data, peak, w, h) {
  const top = Math.max(10, peak || 0, ...data);
  return data.map((v, i) => `${i ? 'L' : 'M'}${(i / (data.length - 1) * w).toFixed(1)} ${(h - 1 - v / top * (h - 3)).toFixed(1)}`).join('');
}
const gridCards = new Map();
function renderGrid() {
  const g = $('#grid'), S = [...snap.sessions].sort((a, b) => (b.health === 'working') - (a.health === 'working') || b.todayTok - a.todayTok);
  if (!S.length) { g.innerHTML = `<div class="meta" style="padding:20px 6px">${snap.ready ? 'No Claude Code sessions running.' : 'Connecting…'}</div>`; gridCards.clear(); return; }
  if (g.querySelector('.meta')) g.innerHTML = '';
  const seen = new Set();
  S.forEach((s, i) => {
    seen.add(s.sid);
    let c = gridCards.get(s.sid);
    if (!c) {
      c = document.createElement('div'); c.className = 'gcard'; c.dataset.sid = s.sid; gridCards.set(s.sid, c);
      let ht = null, held = false;
      c.addEventListener('touchstart', () => { held = false; ht = setTimeout(() => { held = true; navigator.vibrate && navigator.vibrate(10); openDetails(c.dataset.sid); }, 520); }, { passive: true });
      c.addEventListener('touchmove', () => clearTimeout(ht), { passive: true });
      c.addEventListener('touchend', () => clearTimeout(ht), { passive: true });
      c.addEventListener('click', () => { if (!held) pickSplit(c.dataset.sid); });
    }
    if (g.children[i] !== c) g.insertBefore(c, g.children[i] || null);
    const col = FAMILY_COLOR[s.family] || '#9fb4d8', pct = s.ctxMax ? Math.min(100, s.ctx / s.ctxMax * 100) : 0, work = s.health === 'working';
    const last = [...s.log].reverse().find(l => l.kind === 'claude' || l.kind === 'you' || l.kind === 'tool');
    c.className = 'gcard ' + s.health;
    c.innerHTML = `<div class="gh">${AV(s, 'pav gav')}<span class="dot ${s.health}"></span><span class="gn">${esc(s.name)}</span>${SUNTAG(s)}</div>
      <div class="gm"><span style="color:${col}">${esc((s.model || '—').replace('claude-', '').replace(/-\d.*$/, ''))}</span><span>${s.owner ? INAPP() : s.kind === 'bg' ? 'bg' : 'terminal'}</span>${s.serverUses ? '<span>⇄ server</span>' : ''}${s.relaysToday ? `<span class="relays">⇄ ${s.relaysToday}</span>` : ''}</div>
      <div class="gv"><b>${work ? Math.round(s.tps) : fmtTok(s.todayTok)}</b><small>${work ? ' tok/s' : ' today'}</small><span class="gs">${work ? fmtTok(s.todayTok) : ago(s.sinceWrite) + ' ago'}</span></div>
      <svg class="gsp" viewBox="0 0 100 26" preserveAspectRatio="none"><path d="${sparkPath(s.spark || [0, 0], s.sparkPeak, 100, 26)}" stroke="${col}" /></svg>
      <div class="gbar"><div style="width:${pct}%;background:${pct > 85 ? 'var(--err)' : pct > 60 ? 'var(--warn)' : col}"></div></div>
      <div class="gl">${last ? (last.kind === 'you' ? '› ' : last.kind === 'tool' ? ICON.gear + ' ' : '') + esc(last.text) : '—'}</div>`;
  });
  for (const [sid, c] of gridCards) if (!seen.has(sid)) { c.remove(); gridCards.delete(sid); }
  const A = snap.agents || [];
  let ag = $('#gAgents');
  if (A.length) {
    if (!ag) { ag = document.createElement('div'); ag.id = 'gAgents'; }
    g.appendChild(ag);
    ag.innerHTML = `<h3>Agents · ${A.length}</h3>` + A.map(a => `<div class="item"><span class="dot ${a.state === 'running' ? 'working' : 'waiting'}"></span><div class="t"><div class="n">${esc(a.name || a.id)}</div><div class="m">${esc(a.state || '')}</div></div></div>`).join('');
  } else if (ag) ag.remove();
}

// ---------- attach photos / files from the iPhone ----------
// Each file goes to the Mac that runs the session (/api/upload) and comes back as a path, escaped the way Terminal
// drag-and-drop does, so Claude Code turns image paths into [Image #n] attachments and other files into readable paths.
const shq = p => p.replace(/([\s\\'"()&;|<>$`!*?#~{}\[\]])/g, '\\$1');
const fileB64 = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = no; r.readAsDataURL(f); });
function attachInto(field, where) {
  const pick = document.createElement('input'); pick.type = 'file'; pick.multiple = true; pick.style.display = 'none';
  document.body.appendChild(pick);
  pick.onchange = async () => {
    const files = [...pick.files]; pick.remove(); if (!files.length) return;
    toast(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`);
    const got = [];
    for (const f of files) {
      if (f.size > 28e6) { toast(`${f.name} is over 28 MB`); continue; }
      const r = await api('/api/upload', { ...where, name: f.name || 'photo.jpg', b64: await fileB64(f) }).catch(() => ({}));
      if (r.ok && r.path) got.push(shq(r.path)); else toast(`Couldn't upload ${f.name}` + (r.err ? ': ' + r.err : ''));
    }
    if (!got.length) return;
    field.value = (field.value.trim() ? field.value.replace(/\s*$/, ' ') : '') + got.join(' ') + ' ';
    toast(`Attached ${got.length} — add a message and Send`);
  };
  pick.click();
}

// keyboard up (iOS): let the typing surface take the screen
if (window.visualViewport) {
  let wasUp = false;
  // the iOS app reports the keyboard's real height (window.meshKeyboard); in Safari the visual viewport tells us
  let native = null;
  window.meshKeyboard = h => { native = Math.max(0, +h || 0); kb(); };
  const kb = () => { const h = native != null ? native : Math.max(0, innerHeight - visualViewport.height - visualViewport.offsetTop), up = h > 120;
    document.documentElement.style.setProperty('--kb', (up ? h : 0) + 'px'); document.body.classList.toggle('kb', up);
    if (up) { scrollTo(0, 0); if (!wasUp) setTimeout(() => { scrollTo(0, 0); window.meshPinTerm && window.meshPinTerm(); }, 320); } else if (wasUp) resetScroll();
    wasUp = up; requestAnimationFrame(() => viz.resize()); };
  visualViewport.addEventListener('resize', kb); visualViewport.addEventListener('scroll', kb);
  addEventListener('focusout', () => setTimeout(kb, 60));
}
// the bar above the keyboard: "Done" puts the keyboard away (pointerdown so the field doesn't lose focus to the tap first)
$('#kbDone').addEventListener('pointerdown', e => { e.preventDefault(); const a = document.activeElement; if (a && a.blur) a.blur(); });
addEventListener('orientationchange', () => setTimeout(() => { viz.resize(); if (view === 'split' && paneKind && paneKind.startsWith('term')) renderSplit(true); }, 350));
{ const v0 = localStorage.getItem('mesh.view'); const v1 = v0 === 'grid' ? 'grid' : 'split'; setTab(v1, true); setView(v1); }
// ---------- horizontal navigation (2026-11-19, Kevin): [session drawer] <-> [Sessions] <-> [Grid] ----------
// One feel for every sideways transition: the finger drives the layers 1:1 (GPU transforms, written once per frame),
// the next screen slides in beside it, and on release it springs on past ~35 % of the width or on a flick, otherwise it
// springs back. Same curve for the drawer and the pages; the spring gets shorter the faster the finger was moving.
// The drawer belongs to Sessions only: on Grid a right swipe (or ☰) goes back to Sessions. Reduced motion: a quick fade.
const RM = matchMedia('(prefers-reduced-motion: reduce)'), SPRING = 'cubic-bezier(.22,1,.36,1)';
const springMs = (rest, v) => Math.round(Math.max(170, Math.min(420, rest / Math.max(Math.abs(v || 0), 1.1))));
const commits = (d, v, W) => v > 0.45 || (d > W * 0.35 && v > -0.3);   // d, v: distance (px) and speed (px/ms) toward the next screen
const imp = (el, k, v) => v === '' ? el.style.removeProperty(k) : el.style.setProperty(k, v, 'important');   // beats the CSS !important rules
const pageEl = v => v === 'grid' ? $('#grid') : $('#split');
const Pager = (() => {
  let from = null, to = null, W = 1, want = 0, raf = 0, busy = false;
  const side = t => t === 'grid' ? 1 : -1;                              // Grid waits on the right, Sessions on the left
  const put = (a, xa, b, xb, tr) => { a.style.transition = b.style.transition = tr || 'none';
    a.style.transform = `translate3d(${xa}px,0,0)`; b.style.transform = `translate3d(${xb}px,0,0)`; };
  const paint = () => { raf = 0; if (from) put(pageEl(from), want, pageEl(to), want + side(to) * W); };
  const clean = () => { for (const el of [$('#split'), $('#grid')]) el.style.transition = el.style.transform = el.style.willChange = '';
    delete document.body.dataset.peer; from = to = null; busy = false; };
  const show = t => { setTab(t, true); setView(t); };
  function fade(fn) { const A = $('#app'); busy = true; A.style.transition = 'opacity 90ms linear'; A.style.opacity = '0';
    setTimeout(() => { fn(); A.style.opacity = '1'; setTimeout(() => { A.style.transition = A.style.opacity = ''; busy = false; }, 110); }, 95); }
  return {
    busy: () => busy,
    // a finger drag from the current page toward `t`
    begin(t) { from = view; to = t; W = innerWidth; want = 0; busy = true; if (RM.matches) return;
      if (t === 'grid') renderGrid();
      document.body.dataset.peer = t; for (const el of [pageEl(from), pageEl(to)]) el.style.willChange = 'transform'; paint(); },
    move(dx) { if (!from || RM.matches) return; want = side(to) > 0 ? Math.max(-W, Math.min(0, dx)) : Math.min(W, Math.max(0, dx)); if (!raf) raf = requestAnimationFrame(paint); },
    end(go, v) { cancelAnimationFrame(raf); raf = 0; const t = to;
      if (RM.matches) { from = to = null; busy = false; if (go) fade(() => show(t)); return; }
      const endX = go ? -side(t) * W : 0, ms = springMs(Math.abs(endX - want), v);
      put(pageEl(from), endX, pageEl(t), endX + side(t) * W, `transform ${ms}ms ${SPRING}`);
      setTimeout(() => { if (go) show(t); clean(); }, ms + 20); },
    // a tap that changes the page (☰ on Grid, a Grid card, the drawer's links): the same slide, untouched
    go(t) { if (view === t) return show(t); if (busy) return show(t); if (RM.matches) return fade(() => show(t));
      const f = view, a = pageEl(f), b = pageEl(t), W0 = innerWidth, s = side(t); busy = true;
      show(t); document.body.dataset.peer = f;                         // the new page renders first; the old one stays as the peer
      a.style.willChange = b.style.willChange = 'transform'; put(a, 0, b, s * W0);
      requestAnimationFrame(() => requestAnimationFrame(() => put(a, -s * W0, b, 0, `transform 380ms ${SPRING}`)));
      setTimeout(clean, 410); },
  };
})();
function toggleNav(open) { const o = typeof open === 'boolean' ? open : !document.body.classList.contains('navOpen');
  if (o && view === 'grid') return Pager.go('split');                  // the drawer lives on Sessions only
  document.body.classList.toggle('navOpen', o); if (o) renderDrawer(); }
$('#navBtn').onclick = () => toggleNav(); $('#scrim').onclick = () => toggleNav(false);
{ let sx = null, sy = null, mode = null, w = 1, open = false, onTerm = false, lastX = 0, lastT = 0, vx = 0, hs = null;
  const D = $('#drawer'), SC = $('#scrim'), A = $('#app');
  // the drawer: the conversation card slides right and rounds its corners, the drawer underneath comes in from a little
  // to the left and brightens (parallax), the scrim fades
  let want = null, raf = 0;
  const paint = () => { raf = 0; if (want == null) return; const x = w + want, f = Math.max(0, Math.min(1, x / w));
    for (const el of [A, SC, D]) imp(el, 'transition', 'none');
    imp(A, 'transform', `translate3d(${x}px,0,0)`); imp(A, 'border-radius', `${Math.round(28 * f)}px`);
    imp(D, 'transform', `translate3d(${Math.round(-w * 0.22 * (1 - f))}px,0,0)`); imp(D, 'opacity', String(0.35 + 0.65 * f));
    imp(SC, 'opacity', String(f)); imp(SC, 'pointer-events', 'none'); };
  const place = off => { if (RM.matches) return; want = off; if (!raf) raf = requestAnimationFrame(paint); };
  const unpaint = ms => { cancelAnimationFrame(raf); raf = 0; want = null;
    for (const [el, ks] of [[A, ['transform', 'border-radius']], [D, ['transform', 'opacity']], [SC, ['opacity', 'pointer-events']]]) for (const k of ks) imp(el, k, '');
    if (!ms) { for (const el of [A, SC, D]) imp(el, 'transition', ''); return; }
    imp(A, 'transition', `transform ${ms}ms ${SPRING}, border-radius ${ms}ms ${SPRING}, box-shadow ${ms}ms`);
    imp(D, 'transition', `transform ${ms}ms ${SPRING}, opacity ${ms}ms ${SPRING}`); imp(SC, 'transition', `opacity ${ms}ms ${SPRING}`);
    setTimeout(() => { for (const el of [A, SC, D]) imp(el, 'transition', ''); }, ms + 30); };
  // sideways scrollers (the key row, a wide table…) keep the drag while they can still scroll that way
  const scroller = n => { for (; n && n !== document.body; n = n.parentElement) if (n.scrollWidth > n.clientWidth + 1) { const o = getComputedStyle(n).overflowX; if (o === 'auto' || o === 'scroll') return n; } return null; };
  const canScroll = (el, dx) => dx > 0 ? el.scrollLeft > 1 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
  addEventListener('touchstart', e => {
    const t = e.touches[0]; open = document.body.classList.contains('navOpen'); sx = null; mode = null;
    if (e.touches.length !== 1 || Pager.busy()) return;
    const edge = t.clientX < 40;                                         // from the left edge: always a page/drawer swipe
    if (!open && !edge && e.target.closest('textarea, input, .sheet')) return;
    if (!open && e.target.closest('.keys')) return;                       // the key row scrolls itself, never switches pages
    hs = open || edge ? null : scroller(e.target);
    onTerm = !edge && !!e.target.closest('#pxt, #xt');                  // over the terminal: clearly sideways only
    if (!open && view !== 'grid') renderDrawer();
    sx = lastX = t.clientX; sy = t.clientY; lastT = e.timeStamp; vx = 0; w = D.offsetWidth || 300; window.__navDrag = true;
    bindTarget(e.target);
  }, { passive: true });
  // a re-render can replace the element under the finger; its touch events then stop bubbling to window, so the
  // gesture also listens on that element itself (each event is handled once)
  let tgt = null, seen = null;
  const once = f => e => { if (e === seen) return; seen = e; f(e); };
  const onMove = once(e => {
    if (sx == null) return; const t = e.touches[0], dt = e.timeStamp - lastT;
    if (dt > 0) vx = 0.7 * ((t.clientX - lastX) / dt) + 0.3 * vx;      // px per ms, smoothed over the last moves
    lastX = t.clientX; lastT = e.timeStamp;
    let dx = t.clientX - sx; const dy = t.clientY - sy;
    if (!mode) {
      const need = onTerm && !open ? 14 : 10, ratio = onTerm && !open ? 1.6 : 1.4;
      if (!(Math.abs(dx) > need && Math.abs(dx) > Math.abs(dy) * ratio)) { if (Math.abs(dy) > 12 || Math.abs(dx) > need) { sx = null; window.__navDrag = false; } return; }
      if (hs && canScroll(hs, dx)) { sx = null; window.__navDrag = false; return; }
      if (open) mode = dx < 0 ? 'drag' : null;
      else if (view === 'grid') { if (dx > 0) { mode = 'page'; Pager.begin('split'); } }
      else if (dx > 0) mode = 'drag'; else { mode = 'page'; Pager.begin('grid'); }
      if (!mode) { sx = null; window.__navDrag = false; return; }
      sx = t.clientX - Math.sign(dx); dx = Math.sign(dx);               // start tracking from here: no jump
    }
    if (mode === 'page') Pager.move(dx); else place(open ? Math.min(0, dx) : Math.min(0, -w + dx));
  });
  const onCancel = once(() => { unbindTarget(); window.__navDrag = false; if (mode === 'page') Pager.end(false, 0); else if (mode === 'drag') unpaint(0); sx = null; mode = null; });
  const onEnd = once(e => {
    unbindTarget(); window.__navDrag = false;
    if (sx == null || !mode) { sx = null; mode = null; return; }
    const dx = lastX - sx, v = e.timeStamp - lastT > 90 ? 0 : vx;      // a finger that stopped before lifting has no flick
    if (mode === 'page') { const s = view === 'grid' ? 1 : -1; Pager.end(commits(s * dx, s * v, innerWidth), v); }
    else { const s = open ? -1 : 1, go = commits(s * dx, s * v, w), shut = open ? go : !go;
      unpaint(springMs(shut ? (open ? w + Math.min(0, dx) : Math.max(0, dx)) : (open ? -Math.min(0, dx) : w - Math.max(0, dx)), v));
      toggleNav(!shut); }
    sx = null; mode = null;
  });
  const EV = [['touchmove', onMove], ['touchend', onEnd], ['touchcancel', onCancel]];
  function bindTarget(el) { unbindTarget(); tgt = el; for (const [k, f] of EV) el.addEventListener(k, f, { passive: true }); }
  function unbindTarget() { if (tgt) for (const [k, f] of EV) tgt.removeEventListener(k, f); tgt = null; }
  for (const [k, f] of EV) addEventListener(k, f, { passive: true });
}
function renderDrawer() {
  const d = $('#drawer'); if (!document.body.classList.contains('navOpen') && d.dataset.ready) return; d.dataset.ready = 1;
  const ago = x => Math.min(...[x.sinceUse, x.sinceWrite].filter(v => typeof v === 'number' && v >= 0), 9e9);
  const S = [...snap.sessions].sort((a, b) => ((b.health === 'working' || b.health === 'waiting') - (a.health === 'working' || a.health === 'waiting')) || ago(a) - ago(b));
  const st = x => x.health === 'working' ? '<span class="dSpin"></span>' : x.health === 'waiting' ? '<span class="dDot"></span>' : '';
  const html = `<div class="dHead">${esc(APP_NAME)}</div>
    <button class="dRow${view === 'grid' ? ' on' : ''}" data-go="grid"><span class="ic">▦</span>Grid</button>
    <button class="dRow" data-go="history"><span class="ic">↺</span>All sessions</button>
    <button class="dRow" data-theme-next><span class="ic">◐</span><span class="cn">Theme</span><span class="dVal">${esc(themeLabel(themePref))}</span></button>
    <div class="dSec">Sessions</div>
    <div class="dList">${S.map(x => `<button class="dItem${view === 'split' && x.sid === splitSid ? ' on' : ''}" data-sid="${x.sid}">${AV(x, 'pav dav')}<span class="dT"><span class="cn">${esc(x.name)}${SUNTAG(x)}</span><span class="dPrev">${esc(preview(x))}</span></span>${st(x)}</button>`).join('')
      || `<div class="meta" style="padding:10px 14px">${snap.ready ? 'No sessions running.' : 'Connecting…'}</div>`}</div>`;
  // rebuild only when something shows differently, and never under a finger: a replaced element loses its touchend
  if (html === d._html || window.__navDrag) return; d._html = html; d.innerHTML = html;
  d.querySelectorAll('[data-sid]').forEach(b => b.onclick = () => { toggleNav(false); pickSplit(b.dataset.sid); });
  d.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { toggleNav(false); setTab(b.dataset.go); });
  const tb = d.querySelector('[data-theme-next]'); if (tb) tb.onclick = () => { const i = THEMES.indexOf(themePref); setTheme(THEMES[(i + 1) % THEMES.length]); toast('Theme: ' + themeLabel(themePref)); };
}
// the drawer row's second line, like a chat list: what the session did last
function preview(x) {
  const l = [...(x.log || [])].reverse().find(v => v.kind === 'claude' || v.kind === 'you' || v.kind === 'tool');
  return l ? (l.kind === 'you' ? '› ' : '') + String(l.text || '').replace(/[*`#>]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) : (x.model || '').replace('claude-', '');
}

// ---------- press-and-hold a session: what it does, skills, commands, tools, CLAUDE.md ----------
async function openDetails(sid) {
  const s = snap.sessions.find(x => x.sid === sid);
  sheet('details', `<div class="sh-h"><h2>${esc(s ? s.name : 'Session')}</h2><button class="x">×</button></div>${pcBox(sid)}<div class="meta" id="dWait">Reading the session…</div>`, true);
  pcWire();
  const d = await api('/api/details?sid=' + encodeURIComponent(sid));
  if (sheetKind !== 'details') return;
  if (!d || !d.ok) { $('#dWait').textContent = (d && d.err) || 'No details'; return; }
  const chips = list => list.length ? `<div class="chips">${list.map(([k, n]) => `<span class="tag" style="font-size:12.5px;padding:4px 9px">${esc(k)} <span style="opacity:.6">${n}</span></span>`).join('')}</div>` : '<div class="meta">none</div>';
  const what = d.summary ? mdToHtml(d.summary) + '<div class="meta">From the latest /compact summary</div>'
    : `${d.first ? `<p><b>Started with:</b> ${esc(d.first)}</p>` : ''}${d.last && d.last !== d.first ? `<p><b>Latest ask:</b> ${esc(d.last)}</p>` : ''}${d.lastText ? '<p><b>Latest reply:</b></p>' + mdToHtml(d.lastText) : ''}`;
  $('#sheetBody').innerHTML = `<div class="sh-h"><h2>${esc(s ? s.name : d.title || 'Session')}</h2><button class="x">×</button></div>
    <div class="meta">${esc((d.cwd || '').replace(/^\/Users\/[^/]+/, '~'))}</div>
    ${pcBox(sid)}
    <h3>Skills used · ${d.skills.length}</h3>${chips(d.skills)}
    <h3>Slash commands · ${d.cmds.length}</h3>${chips(d.cmds)}
    <h3>What this session does</h3><div class="md" style="max-height:40vh;overflow-y:auto">${what}</div>
    <h3>Tools · ${d.tools.length}</h3>${chips(d.tools)}
    ${d.instructions.map(f => `<details><summary style="color:var(--dim);font-size:12px;margin:12px 0 4px">Instructions · ${esc(f.path)}</summary><div class="md">${mdToHtml(f.text)}</div></details>`).join('')}
    <div class="row" style="margin-top:14px"><button class="primary" id="dOpen">Open session</button></div>`;
  $('#sheetBody .x').onclick = closeSheet; $('#dOpen').onclick = () => openSession(sid); pcWire();
}


// ---------- project cards (2026-11-02; project-cards.js on the Mac): intro + badges in Sessions, intro + next run in a
// session's sheet and its long-press details, and the full card as a sheet. Fetched every 5 min; the card on demand.
let phoneCards = {};
const pcTwo = n => String(n).padStart(2, '0');
const pcWhen = t => { if (!t) return '—'; const d = new Date(t), now = new Date(), tm = `${pcTwo(d.getHours())}:${pcTwo(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return 'today ' + tm; if (d.toDateString() === new Date(now.getTime() + 864e5).toDateString()) return 'tomorrow ' + tm; return `${d.getMonth() + 1}/${d.getDate()} ${tm}`; };
async function pcRefresh() { if (document.hidden) return; try { const r = await api('/api/cards'); if (r && typeof r === 'object' && !r.error) { phoneCards = r; if (sheetKind === 'sessions') renderSessions(); } } catch { } }
setTimeout(pcRefresh, 4000); setInterval(pcRefresh, 5 * 60e3);
function pcBadges(sid) { const c = phoneCards[sid]; if (!c) return ''; return (c.waitingN ? ` <span class="pcb wait">${ICON.flag}${c.waitingN}</span>` : '') + (c.failedN ? ` <span class="pcb fail">✕${c.failedN}</span>` : ''); }
function pcIntro(sid) { const c = phoneCards[sid]; return c && c.intro ? `<div class="pci">${esc(c.intro)}</div>` : ''; }
function pcBox(sid) {
  const c = phoneCards[sid];
  return `<div class="pcbox">${c && c.intro ? `<div>${esc(c.intro)}</div>` : ''}${c && c.next ? `<div class="pcnext">Next: ${esc(c.next.label.replace(/^com\./, ''))} · ${pcWhen(c.next.at)}</div>` : ''}${pcBadges(sid) ? `<div>${pcBadges(sid)}</div>` : ''}<button class="pcbtn" data-card="${esc(sid)}">Project card</button></div>`;
}
function pcWire() { document.querySelectorAll('#sheetBody [data-card]').forEach(b => b.onclick = () => openCard(b.dataset.card)); }
const PC_TABS = [['what', 'What'], ['rules', 'Rules'], ['checks', 'Checks'], ['todo', 'To-do'], ['schedule', 'Schedule'], ['activity', 'Activity']];
function pcBody(c, tab) {
  const src = p => p ? `<span class="pcsrc">${esc(String(p).split('/').slice(-2).join('/'))}</span>` : '';
  const list = (a, f) => a.length ? `<ul class="pcl">${a.map(f).join('')}</ul>` : `<div class="meta">${c.generating ? 'Reading the project…' : c.genFailed ? 'Couldn\'t read the project this time. Reopen to try again.' : 'Nothing found.'}</div>`;
  if (c.empty) return `<div class="meta" style="line-height:1.6"><b>No project notes yet.</b> No rule file and no scheduled jobs.</div><button class="primary" id="pcAsk">Ask this session to write a short CLAUDE.md</button>`;
  if (tab === 'what') return `<p class="pcwhat">${esc(c.intro || (c.generating ? 'Reading the project…' : c.genFailed ? 'Couldn\'t read the project this time. Reopen to try again.' : '—'))}</p><div class="meta">${c.folders.map(esc).join(', ')}</div>`;
  if (tab === 'rules') return list(c.rules, r => `<li>${esc(r.text)} ${src(r.src)}</li>`);
  if (tab === 'checks') return `<h3>Enforced in code</h3>${list(c.checks.filter(x => x.enforced), r => `<li>${esc(r.text)} ${src(r.src)}</li>`)}<h3>Written only</h3>${list(c.checks.filter(x => !x.enforced), r => `<li>${esc(r.text)} ${src(r.src)}</li>`)}`;
  if (tab === 'todo') return `<h3>Waiting on you</h3>${list(c.todo.filter(x => x.waiting_on_owner), r => `<li class="pcwait">${esc(r.text)} ${src(r.src)}</li>`)}<h3>Open items</h3>${list(c.todo.filter(x => !x.waiting_on_owner), r => `<li>${esc(r.text)} ${src(r.src)}</li>`)}`;
  if (tab === 'schedule') return c.schedule.length ? c.schedule.map(j => `<div class="pcjob ${/^failed/.test(j.result) ? 'fail' : ''}"><b>${esc(j.label.replace(/^com\./, ''))}</b><div class="meta">${esc(j.when)} · next ${esc(pcWhen(j.next))}</div><div class="meta">last ${esc(pcWhen(j.at))} · ${esc(j.result)}</div></div>`).join('') : '<div class="meta">No scheduled jobs for this project.</div>';
  return list(c.activity, a => `<li><span class="meta">${esc(pcWhen(Date.parse(a.time)))}</span> ${esc(a.text)} ${src(a.src)}</li>`);
}
async function openCard(sid, tab = 'what') {
  const s = snap.sessions.find(x => x.sid === sid);
  sheet('card', `<div class="sh-h"><h2>${esc(s ? s.name : 'Project')} · card</h2><button class="x">×</button></div><div class="meta">Reading the project…</div>`, true);
  let c = await api('/api/card?sid=' + encodeURIComponent(sid));
  const draw = t => {
    if (sheetKind !== 'card') return;
    sheet('card', `<div class="sh-h"><h2>${esc(s ? s.name : 'Project')} · card</h2><button class="x">×</button></div>
      ${c && !c.empty ? `<div class="pctabs">${PC_TABS.map(([k, l]) => `<button data-t="${k}" class="${k === t ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
      <div class="pcbody">${c ? pcBody(c, t) : '<div class="meta">No card for this session.</div>'}</div>`, true);
    document.querySelectorAll('.pctabs button').forEach(b => b.onclick = () => draw(b.dataset.t));
    const ask = $('#pcAsk'); if (ask) ask.onclick = async () => { await api('/api/card/ask', { sid }); toast('Asked it to write its CLAUDE.md'); closeSheet(); };
  };
  draw(tab);
  for (let i = 0; i < 30 && c && c.generating && sheetKind === 'card'; i++) { await new Promise(r => setTimeout(r, 3000)); c = await api('/api/card?sid=' + encodeURIComponent(sid)); const on = document.querySelector('.pctabs button.on'); draw(on ? on.dataset.t : tab); }
}

// ---------- Live (renderer/live-view.js, the same view as the Mac's Live panel) ----------
// Full screen over everything; polls only while it is open and the page is in view (screenshots ≤ 1 per 3 s, never stored).
let liveCtl = null, liveSid = null;
function openLive(sid) {
  if (!window.LiveView) return toast('Live view is not available');
  liveSid = sid;
  let box = document.getElementById('liveSheet');
  if (!box) {
    box = document.createElement('section'); box.id = 'liveSheet';
    box.innerHTML = '<div class="lvs-bar"><button class="lvs-back">‹ Back</button><b>Live</b></div><div class="lvs-body"></div>';
    document.body.appendChild(box);
    for (const ev of ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'wheel']) box.addEventListener(ev, e => e.stopPropagation(), { passive: true });   // no page swipes underneath
    box.querySelector('.lvs-back').onclick = closeLive;
    const q = (p, o) => api(p + (p.includes('?') ? '&' : '?') + Object.entries(o || {}).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'));
    liveCtl = window.LiveView.create(box.querySelector('.lvs-body'), {
      job: (sid, o) => q('/api/live/job', { sid, procs: o && o.procs ? 1 : 0 }),
      chrome: () => q('/api/live/chrome'), tabs: () => q('/api/live/tabs'),
      shot: (port, target) => q('/api/live/shot', { port, target: target || '' }),
    }, {
      sid: () => liveSid,
      session: sid => (snap.sessions || []).find(x => x.sid === sid),
      visible: () => !!liveSid && document.visibilityState === 'visible',
    });
    document.addEventListener('visibilitychange', () => { if (liveSid) liveCtl.tick(); });
  }
  box.classList.add('on'); liveCtl.tick();
}
function closeLive() { liveSid = null; const b = document.getElementById('liveSheet'); if (b) b.classList.remove('on'); if (liveCtl) liveCtl.stop(); }
