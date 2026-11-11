const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// token counts the way people say them: 950, 7.7k, 77k, 1.1M, 12M, 1.3B
const fmtTok = v => { v = Math.max(0, v || 0); const u = v >= 1e9 ? [1e9, 'B'] : v >= 1e6 ? [1e6, 'M'] : v >= 1e3 ? [1e3, 'k'] : null; if (!u) return String(Math.round(v)); const x = v / u[0]; return (x < 10 ? x.toFixed(1).replace(/\.0$/, '') : Math.round(x)) + u[1]; };
const fmtN = v => v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : String(Math.round(v || 0));
const ago = s => s < 60 ? Math.round(s) + 's' : s < 3600 ? Math.round(s / 60) + 'm' : (s / 3600).toFixed(1) + 'h';
const hhmm = t => t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '';
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } } };

// live-dot glow: rows are re-rendered every tick, so pin each pulse to the shared document clock (no restart flicker)
document.addEventListener('animationstart', e => {
  if (e.animationName === 'liveGlow') for (const a of e.target.getAnimations()) if (a.animationName === 'liveGlow') a.startTime = 0;
});

let snap = { sessions: [], models: [], ptys: [] };
let selected = null;
let bell = store.get('bell', true);
const prevHealth = new Map();
// sessions that finished (or stopped to ask you something) and you haven't looked at yet → red title, soft blink
const doneSids = new Set(store.get('doneSids', []));
const saveDone = () => store.set('doneSids', [...doneSids]);
const doneFade = new Map();   // sid → when it was looked at; fades out over FADE_MS instead of vanishing
const FADE_MS = 900, BLINK_MS = 2400;
// lists re-render every second, so the animations are pinned to the clock (negative delay) instead of restarting
function doneCls(sid) {
  if (doneSids.has(sid)) return ` done" style="animation-delay:-${(Date.now() % BLINK_MS) / 1000}s`;
  const f = doneFade.get(sid); if (!f) return '';
  const el = Date.now() - f.t; if (el >= FADE_MS) { doneFade.delete(sid); return ''; }
  return ` done-out" style="--a:${f.a.toFixed(3)};animation-delay:-${el / 1000}s`;
}
function seen(sid) { if (sid && doneSids.delete(sid)) { saveDone(); { const t = Date.now(); doneFade.set(sid, { t, a: .5 - .5 * Math.cos(2 * Math.PI * (t % BLINK_MS) / BLINK_MS) }); /* start from where the glow is now */ } renderList(); typeof renderHistory === 'function' && renderHistory();
  setTimeout(() => { renderList(); typeof renderHistory === 'function' && renderHistory(); }, FADE_MS + 50); } }
const terms = new Map();   // ptyId -> {term, fit, el, title, kind}
let activeTerm = null;

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600); }

// ---------------- mesh ----------------
const viz = new Mesh($('#mesh'), { onSelect: sid => select(sid), onHub: () => openStarMenu() });
// the mother star's menu: Broadcast and Token usage, at the pointer
let lastPointer = { x: 200, y: 200 }; addEventListener('pointerdown', e => { lastPointer = { x: e.clientX, y: e.clientY }; }, true);
function openStarMenu() {
  let m = $('#starMenu'); if (m) m.remove();
  m = document.createElement('div'); m.id = 'starMenu'; m.innerHTML = '<button data-a="bc">Broadcast…</button><button data-a="usage">Token usage</button>'; document.body.appendChild(m);
  m.style.left = Math.min(innerWidth - 180, lastPointer.x + 6) + 'px'; m.style.top = Math.min(innerHeight - 90, lastPointer.y + 6) + 'px';
  const shut = () => { m.remove(); removeEventListener('pointerdown', away, true); }, away = e => { if (!m.contains(e.target)) shut(); };
  m.onclick = e => { const a = e.target.dataset.a; if (!a) return; shut(); a === 'bc' ? openBroadcast() : openUsage(); };
  addEventListener('pointerdown', away, true);
}
function openUsage() {
  window.usageView.open({ box: (html, wide) => { const c = document.querySelector('#modalCard .uview'), st = c && c.closest('#modalCard').scrollTop; modal(html + '<div class="btns" style="justify-content:flex-end"><button id="mCancel">Close</button></div>'); $('#modalCard').classList.add('wide'); if (st) $('#modalCard').scrollTop = st; },
    get: () => window.api.usage.dash(), session: l => window.api.usage.session(l), setManual: p => window.api.usage.manual(p) });
}
// the black hole (blackhole.js): 'check' on release (only sessions we can type into go in), 'send' when it crosses the
// horizon (the Undo window is over), 'refuse' for a group dropped on it, 'stuck' if it never went away
viz.onTrash = (sid, phase) => {
  const s = snap.sessions.find(q => q.sid === sid);
  if (phase === 'refuse') return toast('Groups can\'t go in the black hole. Drag the session out of its group first.');
  if (!s) return phase === 'check' ? 'gone' : undefined;
  if (phase === 'check') { if (canControl(s)) return true; toast(`${s.name} is view-only. It can't be ended from here.`); return false; }
  if (phase === 'send' && window.cleanupTake && window.cleanupTake(s)) return;     // part of a cleanup: it reports once, for all of them
  if (phase === 'send') return sessSend(s, '/exit').then(r => toast(r && (r.ok === false || r.out === 'notfound') ? `Couldn't send /exit to ${s.name}` : `/exit → ${s.name}`));
  if (phase === 'stuck') toast(`${s.name} didn't exit. It's back out of the black hole.`);
};
// springboard grouping on the mesh (springboard.js): a session held 3 s on another → a new group; on a portal → joins it
viz.onMerge = async (sid, to) => {
  const s = snap.sessions.find(x => x.sid === sid); if (!s) return;
  if (to.gid) { await window.api.groups.set(sid, to.gid); return toast(`${s.name} added to ${(snap.groups[to.gid] || {}).name || 'the group'}`); }
  const o = snap.sessions.find(x => x.sid === to.sid); if (!o) return;
  // a name like the iPhone's folder guess: the words the two names start with, else "Group N"
  const wa = String(o.name || '').split(/\s+/), wb = String(s.name || '').split(/\s+/); let k = 0; while (k < wa.length && k < wb.length && wa[k].toLowerCase() === wb[k].toLowerCase()) k++;
  const name = k ? wa.slice(0, k).join(' ') : 'Group ' + (Object.keys(snap.groups || {}).length + 1);
  await window.api.groups.create(name, [to.sid, sid]); toast(`Portal opened: ${name} (double-click it in Sessions to rename)`);
};
viz.onGroup = (gid, collapsed) => { window.api.groups.update(gid, { collapsed }); if (snap.groups && snap.groups[gid]) snap.groups[gid].collapsed = collapsed; renderList(); };   // a portal clicked on the mesh
window.api.onVisible(v => { viz.offscreen = !v; if (v) { viz.wake(); for (const [, t] of terms) if (termVisible(t)) flushTerm(t); } });

// ---------------- telemetry ----------------
window.api.onTelemetry(s => {
  snap = s;
  if (s.ready) $('#loading').style.display = 'none';
  if (window.refreshMigrate) window.refreshMigrate(s.sessions);   // a refreshed session keeps its orbit (refresh-ui.js)
  viz.update(s);
  renderHeader(); renderList(); renderToday(); renderPanel(); syncPeerTerms(); syncTermTitles(); notifyTransitions(); renderRail(); renderBoard();
});

// memory of each machine, as Activity Monitor's "Memory Used"; the bar turns amber/red with macOS memory pressure
// "MacBook" / "MacMini" (peer.json labels) → how macOS names them
const macName = l => ({ MacMini: 'Mac mini', MacBook: 'MacBook' })[l] || l || 'other Mac';
// header button: Screen Sharing to the other Mac (shown while a peer is paired)
function renderVncBtn(snap) {
  const b = $('#vncBtn'), p = snap.peer; b.hidden = !(p && p.host);
  if (b.hidden) return;
  const name = macName(p.label);
  b.querySelector('span').textContent = name;
  b.title = `Screen share ${name} (vnc://${p.host})${p.online ? '' : ' — it looks offline right now'}`;
  b.classList.toggle('off', !p.online); b.dataset.host = p.host;
}
$('#vncBtn').onclick = e => { const h = e.currentTarget.dataset.host; if (h) window.api.vncOpen(h); };
// ---------------- today's calendar (header ribbon) ----------------
const CAL_HOME = 'https://calendar.google.com/calendar/u/0/r';
let calState = { status: 'idle', events: [] };
const hm = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
const inMin = ms => { const m = Math.round(ms / 60e3); return m < 60 ? `in ${m}m` : `in ${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}`; };
function renderCal() {
  const el = $('#cal'); if (!el) return;
  const now = Date.now(), lastDay = calState.status === 'ok' && calState.at && new Date(calState.at).toDateString() !== new Date(now).toDateString();
  const st = lastDay ? { ...calState, status: 'offline', error: calState.error || 'not refreshed since yesterday' } : calState;   // past midnight with no refresh: yesterday's list isn't today's
  if (st.status === 'disconnected' || st.status === 'idle') { el.innerHTML = `<button class="cal-connect" data-cal="connect" title="Show today's events here (read-only)">📅 Connect calendar</button>`; return; }
  if (st.status === 'loading' || st.status === 'offline') { el.innerHTML = `<a class="cal-item done" data-link="${CAL_HOME}" title="${esc(st.status === 'offline' ? `Still connected. Can't reach Google right now (${st.error || 'offline'}), retrying by itself.` : '')}">📅 ${st.status === 'offline' ? 'Retrying' : 'Calendar'}</a>`; return; }
  if (st.status === 'connecting') { el.innerHTML = `<span class="cal-note">Approve in your browser…</span>`; return; }
  if (st.status === 'error') { el.innerHTML = `<button class="cal-connect warn" data-cal="${st.enableUrl ? 'enable' : 'connect'}" title="${esc(st.error || '')}">📅 ${esc(st.enableUrl ? 'Enable Calendar API' : 'Reconnect')}</button>`; return; }
  const todays = (st.events || []).filter(e => !e.allDay && e.end > now);
  const allDay = (st.events || []).filter(e => e.allDay);
  if (!todays.length && !allDay.length) { el.innerHTML = `<a class="cal-item done" data-link="${CAL_HOME}">📅 Nothing else today</a>`; return; }
  const items = todays.slice(0, 2).map((e, i) => {
    const live = e.start <= now, soon = !live && e.start - now < 15 * 60e3, imminent = !live && e.start - now <= 5 * 60e3;   // ≤ 5 min: slow pulse
    const when = live ? `<b class="cal-now">now</b> · till ${hm(e.end)}` : `${hm(e.start)} · ${inMin(e.start - now)}`;
    const pulse = imminent ? ` style="animation-delay:-${(now % 2800) / 1000}s"` : '';          // pinned to the clock so a re-render doesn't restart it
    return `<a class="cal-item${live ? ' live' : imminent ? ' soon imminent' : soon ? ' soon' : ''}"${pulse} data-link="${esc(e.meet && (live || soon) ? e.meet : e.link || CAL_HOME)}" title="${esc(e.title)} — ${hm(e.start)}–${hm(e.end)}${e.meet ? '\nClick to join the call' : ''}">
      <span class="cal-dot" style="background:${esc(e.color || '#7c86b8')}"></span><span class="cal-t">${esc(e.title)}</span><span class="cal-w">${when}</span></a>`;
  });
  const more = todays.length > 2 ? `<a class="cal-item more" data-link="${CAL_HOME}" title="${esc(todays.slice(2).map(e => hm(e.start) + '  ' + e.title).join('\n'))}">+${todays.length - 2}</a>` : '';
  const ad = allDay.length && !todays.length ? `<a class="cal-item" data-link="${CAL_HOME}"><span class="cal-t">${esc(allDay[0].title)}</span><span class="cal-w">all day</span></a>` : '';
  el.innerHTML = items.join('') + more + ad;
}
$('#cal').addEventListener('click', e => {
  const b = e.target.closest('[data-cal]'), a = e.target.closest('[data-link]');
  if (b && b.dataset.cal === 'connect') return window.api.cal.connect();
  if (b && b.dataset.cal === 'enable') return window.api.cal.open(calState.enableUrl);
  window.api.cal.open(a ? a.dataset.link : CAL_HOME);
});
window.api.cal.onChange(s => { calState = s; renderCal(); });
window.api.cal.get().then(s => { if (s) { calState = s; renderCal(); } });
setInterval(renderCal, 30e3);                                             // countdowns and "now" move on their own
// Window menu → Show: each unticked item adds body.hide-<key> (style.css hides it)
function applyHidden(h) { for (const k of ['models', 'cal', 'counts', 'versions', 'left', 'mem', 'viewSeg', 'simple', 'sched', 'vnc', 'phone', 'bell', 'side', 'panel', 'usage']) document.body.classList.toggle('hide-' + k, !!(h && h[k])); viz.hideUsage = !!(h && h.usage); viz.hideFx = h || {}; }
window.api.ui.hidden().then(applyHidden); window.api.ui.onHidden(applyHidden);
if (window.api.onCinePlay) window.api.onCinePlay(o => viz.cinePlaySoon(o));   // View ▸ Play Screen Saver / Screen Saver Stories
// the Mac's screen locks → Simple mode (nothing animating for a Screen Sharing client); back to the mesh on unlock — only if
// it was the lock that turned Simple on, and not while a Screen Sharing client is still connected (main.js decides that)
let lockSimple = false;
if (window.api.onScreenLock) window.api.onScreenLock(s => {
  if (s.locked === true) { if (viz.cine) viz.cineEnd(); if (!isSimple()) { lockSimple = true; setSimple(true); } }
  else if (s.locked === false && lockSimple) { lockSimple = false; if (isSimple()) setSimple(false); }
});
if (window.api.ui.onResetLayout) window.api.ui.onResetLayout(() => { viz.resetLayout(); viz.hub.y = viz.motherY(); toast('Sizes and positions reset'); });   // Window ▸ Reset sizes & positions
// team use (see main.js FEATURES / team.json): hide what this Mac isn't set up for; the header shows "<team> Mesh"
window.api.features().then(f => { document.body.classList.toggle('no-schedules', !f.schedules); document.body.classList.toggle('no-calendar', !f.calendar); });
function applyTeam(t) { const name = t && t.name ? `${t.name} Mesh` : APP_NAME; $('.bname').textContent = name; document.title = name; }
window.api.team.get().then(applyTeam);
window.api.team.onEdit(async () => {
  const t = await window.api.team.get();
  modal(`<h2>Team name</h2><p style="color:var(--dim);margin:6px 0 12px">Shown in the top bar as “<b>Team</b> Mesh”. Leave empty for “${APP_NAME}”.</p>
    <input id="teamName" maxlength="40" placeholder="e.g. SDA, 물류팀" value="${esc(t.name || '')}" style="width:100%">
    <div class="btns" style="justify-content:flex-end;margin-top:14px"><button id="mCancel">Cancel</button><button class="primary" id="teamOk">Save</button></div>`);
  const save = async () => { applyTeam(await window.api.team.set($('#teamName').value)); closeModal(); };
  $('#teamOk').onclick = save; $('#teamName').onkeydown = e => { if (e.key === 'Enter') save(); }; $('#teamName').focus();
});
function memPill(label, m) {
  if (!m || !m.total) return '';
  const gb = b => (b / 2 ** 30).toFixed(1), pct = Math.min(100, Math.round(m.used / m.total * 100));
  const lvl = m.pressure >= 4 ? 'crit' : m.pressure >= 2 ? 'warn' : 'ok';
  return `<span class="hpill mem ${lvl}" title="${esc(label)}: ${gb(m.used)} of ${gb(m.total)} GB memory used${lvl === 'ok' ? '' : ' · memory pressure ' + (lvl === 'crit' ? 'critical' : 'high')}">${esc(label)} <i>${gb(m.used)}/${Math.round(m.total / 2 ** 30)} GB</i><span class="membar"><span style="width:${pct}%"></span></span></span>`;
}
// what's left of the plan: 5-hour session, weekly (all models) and the dollar credits (core.js refreshUsage)
function leftPills(u) {
  if (!u) return '';
  const when = t => { if (!t) return ''; const m = Math.max(0, Math.round((t - Date.now()) / 60000));
    return m < 60 ? `${m}m` : m < 48 * 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
  const pill = (label, leftPct, val, tip) => { const p = Math.max(0, Math.min(100, Math.round(leftPct)));
    return `<span class="hpill mem left ${p <= 10 ? 'crit' : p <= 25 ? 'warn' : 'ok'}" title="${esc(tip)}">${esc(label)} <i>${esc(val)}</i><span class="membar"><span style="width:${p}%"></span></span></span>`; };
  const L = u.limits || [], s = L.find(l => l.kind === 'session'), w = L.find(l => l.kind === 'weekly_all');
  const usd = n => '$' + (n >= 100 ? Math.round(n) : n.toFixed(2));
  return (s ? pill('Session', 100 - s.used, `${Math.round(100 - s.used)}% left`, `5-hour session: ${Math.round(s.used)}% used · resets in ${when(s.resetsAt)}`) : '')
    + (w ? pill('Week', 100 - w.used, `${Math.round(100 - w.used)}% left`, `Weekly limit (all models): ${Math.round(w.used)}% used · resets ${when(w.resetsAt)}`) : '')
    + (u.credits || []).map(c => pill(c.label, c.left / c.limit * 100, `${usd(c.left)}/${usd(c.limit)}`,
      `${c.label}: ${usd(c.used)} used of ${usd(c.limit)}, ${usd(c.left)} left${c.resetsAt ? ' · resets ' + when(c.resetsAt) : ''}`)).join('');
}
function renderUsagePill() {
  const u = snap.usageSum, el = $('#usagePill'); if (!el) return;
  el.textContent = u ? `Week ${fmtTok(u.week)}${u.top ? ` · top: ${u.top}` : ''}` : 'Token usage';
}
function renderHeader() {
  renderUsagePill();
  renderVncBtn(snap);
  const order = ['fable', 'mythos', 'opus', 'sonnet', 'haiku', 'other'];
  const ms = [...snap.models].sort((a, b) => order.indexOf(a.family) - order.indexOf(b.family));
  $('#models').innerHTML = ms.map(m => `<div class="mchip" title="${m.sessions} live session(s) · ${fmtN(m.todayOut)} output tokens today · burn ${fmtTok(m.liveTokHr)} tokens/h (last 5 min)">
    <span class="dot" style="background:${FAMILY_COLOR[m.family]};box-shadow:0 0 8px ${FAMILY_COLOR[m.family]}"></span>
    <b>${m.family[0].toUpperCase() + m.family.slice(1)}</b><span>${fmtTok(m.todayTok)}</span>
    <span class="sub">${Math.round(m.tps)} tok/s · ${fmtTok(m.liveTokHr)}/h</span></div>`).join('');
  const c = k => snap.sessions.filter(s => s.health === k).length;
  const errs = snap.sessions.reduce((a, s) => a + s.errors1h, 0);
  $('#health').innerHTML = `<span class="hpill cnt">working <i>${c('working')}</i></span>
    <span class="hpill cnt">idle <i>${c('idle')}</i></span>
    ${c('waiting') + c('quiet') ? `<span class="hpill cnt" style="border-color:#6b5a1a">attention <i>${c('waiting') + c('quiet')}</i></span>` : ''}
    <span class="hpill cnt" ${errs ? 'style="border-color:#6b2a2a"' : ''}>API errors 1h <i>${errs}</i></span>
    ${snap.peer && snap.peer.online && snap.peer.build && snap.build && snap.peer.build !== snap.build
      ? `<span class="hpill ver" style="border-color:#6b5a1a" title="This Mac runs build ${esc(snap.build)}, ${esc(snap.peer.label)} runs ${esc(snap.peer.build)}. Install the same " + APP_NAME + " on both and restart it.">versions differ</span>` : ''}
    ${leftPills(snap.usage)}${memPill(snap.peer ? 'This Mac' : 'RAM', snap.mem)}${snap.peer && snap.peer.mem ? memPill(snap.peer.label, snap.peer.mem) : ''}`;
}

const subsOpen = store.get('subsOpen', {});
function renderList() {
  if (listDrag) return;                                        // don't swap the rows out from under a drag
  $('#sessCount').textContent = snap.ready ? `· ${snap.sessions.length}` : '· reading…';
  // working (green) sessions on top, then everything by most recent activity; a group sits where its liveliest
  // member would, with its members under a header (collapsible, like its portal on the mesh)
  const key = s => [s.health === 'working' ? 0 : 1, s.sinceUse ?? s.sinceWrite ?? 1e9];
  const cmp = (a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1];
  const S = [...snap.sessions].sort(cmp), G = snap.groups || {}, byG = new Map();
  for (const s of S) if (s.group && G[s.group]) { if (!byG.has(s.group)) byG.set(s.group, []); byG.get(s.group).push(s); }
  // sub-sessions (main.js linkSubSessions) hang under their main session, folded away until you open them
  const live = new Set(S.map(s => s.sid)), subs = new Map();
  for (const s of S) if (s.parent && live.has(s.parent) && !(s.group && G[s.group])) { if (!subs.has(s.parent)) subs.set(s.parent, []); subs.get(s.parent).push(s); }
  const isSub = s => s.parent && live.has(s.parent) && !(s.group && G[s.group]);
  const withSubs = (s, cls) => {
    const k = subs.get(s.sid); if (!k) return srowHtml(s, cls);
    const open = subsOpen[s.sid] || k.some(x => x.sid === selected), work = k.some(x => x.health === 'working');
    return srowHtml(s, cls) + `<div class="subtog" data-sub="${s.sid}" title="${open ? 'Hide' : 'Show'} the sessions this one spawned"><span class="gchev">${open ? '▾' : '▸'}</span><span>${k.length} sub-session${k.length > 1 ? 's' : ''}</span>${work ? '<span class="hdot h-working"></span>' : ''}</div>`
      + (open ? k.map(x => srowHtml(x, ' inSub' + cls)).join('') : '');
  };
  const items = [];
  for (const s of S) {
    if (isSub(s)) continue;
    if (!s.group || !G[s.group]) items.push(withSubs(s, ''));
    else if (byG.get(s.group)[0] === s) {                      // the group's first (liveliest) member places the group
      const g = G[s.group], m = byG.get(s.group), work = m.some(x => x.health === 'working');
      items.push(`<div class="ghead ${g.collapsed ? 'shut' : ''}" data-g="${s.group}" title="Click to ${g.collapsed ? 'open' : 'close'} the portal · double-click to rename · drop a session here to add it">
        <span class="gchev">${g.collapsed ? '▸' : '▾'}</span><span class="gsig">◎</span><span class="gname">${esc(g.name)}</span><span class="gcount">${m.length}</span>${work ? '<span class="hdot h-working"></span>' : ''}<span class="gx" data-gx="${s.group}" title="Ungroup">×</span></div>`);
      if (!g.collapsed) for (const x of m) items.push(withSubs(x, ' inG'));
    }
  }
  $('#list').innerHTML = items.join('');
  for (const el of document.querySelectorAll('.srow')) el.onclick = () => select(el.dataset.sid);
  for (const el of document.querySelectorAll('.srow .fold')) el.onclick = e => { e.stopPropagation(); window.openSessionFolder && window.openSessionFolder(el.dataset.fold); };
}
// the session's project folder (folder-pods.js): a button that opens it in Finder
const FOLDER_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.75 7.5a2 2 0 0 1 2-2h3.6l2.1 2.25h6.8a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H5.75a2 2 0 0 1-2-2z"/><path d="M3.75 10.25h16.5"/></svg>';
const foldBtn = s => { const f = window.sessionFolders && window.sessionFolders[s.sid]; return f ? `<span class="fold" ${f.pending ? 'style="opacity:.4"' : ''} data-fold="${esc(f.path)}" title="${f.pending ? `${esc(f.label)}: ${esc(f.why)}` : `Open ${esc(f.label)} in Finder (${esc(f.why)})`}">${FOLDER_SVG}</span>` : ''; };
// one session row; draggable onto another row (→ new group of both) or onto a group header (→ joins it)
const cardBits = s => window.cardRowBits ? window.cardRowBits(s) : { badges: '', intro: '' };
const srowHtml = (s, cls, cb = cardBits(s)) => `<div class="srow${cls} ${s.sid === selected ? 'sel' : ''}${doneCls(s.sid)}" data-sid="${s.sid}" draggable="true">
    <div class="n"><span class="hdot h-${s.health}"></span><span class="t">${esc(s.name)}</span>${s.onPeer || s.hostLabel ? peerTag(s) : s.owner ? '<span class="tag">app</span>' : s.kind === 'bg' ? '<span class="tag">bg</span>' : ''}${cb.badges}${foldBtn(s)}<span class="more" data-more="${s.sid}" title="Commands (or right-click)">⋯</span></div>
    <div class="m"><span style="color:${FAMILY_COLOR[s.family]}">${esc((s.model || '—').replace('claude-', ''))}</span><span>${fmtTok(s.todayTok)}</span><span>${s.health === 'working' ? Math.round(s.tps) + ' tok/s' : ago(s.sinceUse ?? s.sinceWrite)}</span></div>${cb.intro}
  </div>`;

// ---------------- groups: drag & drop in the list, header clicks ----------------
let listDrag = null;
async function newGroup(sids, suggest) {
  const name = await askText('New group', 'Name this group (its portal on the mesh shows it)', suggest || 'Group ' + (Object.keys(snap.groups || {}).length + 1));
  if (!name) return;
  await window.api.groups.create(name, sids); toast(`Portal opened: ${name}`);
}
function askText(title, hint, value) {
  return new Promise(res => {
    modal(`<h2>${esc(title)}</h2><div style="color:var(--dim);margin-bottom:10px">${esc(hint)}</div><input id="mText" value="${esc(value || '')}" style="width:100%">
      <div class="btns" style="justify-content:flex-end"><button id="mCancel">Cancel</button><button class="primary" id="mOk">OK</button></div>`);
    const i = $('#mText'); i.focus(); i.select();
    const done = v => { closeModal(); res(v); };
    $('#mCancel').onclick = () => done(null); $('#mOk').onclick = () => done(i.value.trim() || null);
    i.onkeydown = e => { if (e.key === 'Enter') done(i.value.trim() || null); else if (e.key === 'Escape') done(null); };
  });
}
$('#list').addEventListener('dragstart', e => { const r = e.target.closest('.srow'); if (!r) return; listDrag = r.dataset.sid; e.dataTransfer.setData('text/plain', listDrag); e.dataTransfer.effectAllowed = 'move'; r.classList.add('dragging'); });
$('#list').addEventListener('dragend', () => { listDrag = null; document.querySelectorAll('.dropT').forEach(x => x.classList.remove('dropT')); renderList(); });
$('#list').addEventListener('dragover', e => {
  if (!listDrag) return; const t = e.target.closest('.srow, .ghead'); document.querySelectorAll('.dropT').forEach(x => x !== t && x.classList.remove('dropT'));
  if (t && t.dataset.sid !== listDrag) { e.preventDefault(); t.classList.add('dropT'); }
});
$('#list').addEventListener('drop', async e => {
  const sid = listDrag, t = e.target.closest('.srow, .ghead'); if (!sid || !t) return; e.preventDefault();
  listDrag = null;
  if (t.dataset.g) { await window.api.groups.set(sid, t.dataset.g); toast(`Added to ${(snap.groups[t.dataset.g] || {}).name || 'group'}`); }
  else if (t.dataset.sid && t.dataset.sid !== sid) {
    const other = snap.sessions.find(x => x.sid === t.dataset.sid);
    if (other && other.group && snap.groups[other.group]) { await window.api.groups.set(sid, other.group); toast(`Added to ${snap.groups[other.group].name}`); }
    else await newGroup([t.dataset.sid, sid]);
  }
  renderList();
});
$('#list').addEventListener('click', async e => {
  const sub = e.target.closest('[data-sub]');
  if (sub) { const k = sub.dataset.sub; if (subsOpen[k]) delete subsOpen[k]; else subsOpen[k] = 1; store.set('subsOpen', subsOpen); return renderList(); }
  const x = e.target.closest('[data-gx]');
  if (x) { e.stopPropagation(); const g = snap.groups[x.dataset.gx]; await window.api.groups.remove(x.dataset.gx); toast(`Ungrouped ${g ? g.name : ''}`); return; }
  const h = e.target.closest('.ghead'); if (!h) return;
  const g = snap.groups[h.dataset.g]; if (!g) return;
  g.collapsed = !g.collapsed; window.api.groups.update(h.dataset.g, { collapsed: g.collapsed }); renderList();
});
$('#list').addEventListener('dblclick', async e => {
  const h = e.target.closest('.ghead'); if (!h) return; const g = snap.groups[h.dataset.g]; if (!g) return;
  const name = await askText('Rename group', 'New name', g.name); if (name) { g.name = name; window.api.groups.update(h.dataset.g, { name }); renderList(); }
});

// the thin ring on a Simple-view card: this session's share of today's tokens
function usageRing(s) {
  const all = snap.sessions.reduce((a, x) => a + (x.todayTok || 0), 0), p = all ? Math.round((s.todayTok || 0) / all * 100) : 0, c = 2 * Math.PI * 7;
  return `<svg class="bring" viewBox="0 0 18 18" role="img" aria-label="${p}% of today's tokens"><title>${p}% of today's tokens</title><circle cx="9" cy="9" r="7"/><circle class="on" cx="9" cy="9" r="7" stroke-dasharray="${(p / 100 * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 9 9)"/></svg>`;
}
// Simple-mode stand-in for the mesh: one static card per session; repainted only when its text changes
let lastBoard = '';
function renderBoard() {
  if (!isSimple()) return;
  const html = (window.cleanupBar ? window.cleanupBar() : '') + (snap.sessions.map(s => `<div class="bcard ${s.sid === selected ? 'sel' : ''}" data-sid="${s.sid}">
    <div class="n"><span class="hdot h-${s.health}"></span><span class="t">${esc(s.name)}</span>${peerTag(s)}${usageRing(s)}</div>
    <div class="m"><span style="color:${FAMILY_COLOR[s.family]}">${esc((s.model || '—').replace('claude-', ''))}</span><span>${fmtTok(s.todayTok)}</span><span>${s.health === 'working' ? 'working' : s.health}</span></div>
  </div>`).join('') || '<div class="bempty">No live sessions.</div>');
  if (html === lastBoard) return;
  lastBoard = html; $('#board').innerHTML = html;
}
$('#board').addEventListener('click', e => { if (e.target.closest('[data-clean]')) return window.openCleanup(); const c = e.target.closest('.bcard'); if (c) select(c.dataset.sid); });
$('#board').addEventListener('contextmenu', e => { const c = e.target.closest('.bcard'); if (c) { e.preventDefault(); openCmdMenu(c.dataset.sid, e.clientX, e.clientY); } });

function renderToday() {
  if (!snap.ready) { $('#today').textContent = 'Reading…'; return; }
  const tot = snap.todayTok || 0;
  const burn = snap.models.reduce((a, m) => a + (m.liveTokHr || 0), 0);
  $('#today').innerHTML = `<div class="big">${fmtTok(tot)}</div><div style="margin-bottom:10px">tokens today · burn rate ${fmtTok(burn)}/h · all transcripts</div>` +
    snap.models.filter(m => m.todayTok > 0).sort((a, b) => b.todayTok - a.todayTok).map(m => `
    <div style="display:flex;justify-content:space-between"><span>${m.family}</span><span>${fmtTok(m.todayTok)}</span></div>
    <div class="bar"><div style="width:${tot ? m.todayTok / tot * 100 : 0}%;background:${FAMILY_COLOR[m.family]}"></div></div>`).join('');
}

// ---------------- detail panel ----------------
const termOf = s => s && (s.owner || s.pane);   // the session's terminal tab: in-app pty or its tmux pane
// a mirror tab (the other Mac's terminal, or one of our tmux panes) closed with × is detached and never reattached by
// itself: clicking its session must open it again, like a hidden in-app tab comes back (2026-11-09)
function bringTerm(s) {
  const id = s && termOf(s); if (!id) return false;
  if (!terms.has(id) && peerClosed.has(id)) { peerClosed.delete(id); syncPeerTerms(); renderTabs(); layoutGrid(); }
  return terms.has(id);
}
function select(sid) {
  seen(sid);
  const ms = sid && snap.sessions.find(x => x.sid === sid);
  if (isMini() && bringTerm(ms)) { selected = sid; viz.selected = sid; $('#panel').classList.add('hidden'); miniShow('term'); activate(termOf(ms)); renderList(); return; }
  selected = sid; viz.selected = sid;
  $('#panel').classList.toggle('hidden', !sid);
  $('#panelBody').innerHTML = sid ? '<div id="pStatic"></div><div id="pCtl"></div>' : '';
  if (sid) { renderCtl(); renderPanel(); }
  renderList(); renderBoard();
  // an in-app session: bring its terminal tab to the front in the dock (Split / Grid views)
  const s = sid && snap.sessions.find(x => x.sid === sid);
  if (s && bringTerm(s) && (termOf(s) !== activeTerm || !terms.get(termOf(s)).el.classList.contains('on')) && document.body.dataset.view !== 'mesh') activate(termOf(s));
  requestAnimationFrame(() => viz.resize());
}

// a session running somewhere Mesh can't reach (a Terminal tab that's gone, an orphaned tmux server): move it into an
// in-app terminal — it's stopped and resumed with --resume, so its conversation carries on
function adoptSession(s) {
  modal(`<h2>Open ${esc(s.name)} in ${APP_NAME}?</h2><div style="color:var(--dim);margin:6px 0 14px;line-height:1.5">It runs in a terminal ${APP_NAME} can't reach (${esc(s.tty || 'no tty')}), so its CLI can't be shown here. ${APP_NAME} can stop it and resume it in its own terminal — the conversation carries on where it left off.${s.health === 'working' ? '<br><b style="color:#fbbf24">It\'s working right now; the current step will be interrupted.</b>' : ''}</div>
    <div class="btns" style="justify-content:flex-end"><button id="mCancel">Cancel</button><button class="primary" id="aOk">Open in ${APP_NAME}</button></div>`);
  $('#aOk').onclick = async () => { closeModal(); toast('Moving ' + s.name + ' into ' + APP_NAME + '…'); const r = await window.api.ext.adopt({ pid: s.pid, sid: s.sid, cwd: s.cwd, name: s.name }); if (!r || !r.ok) toast('Could not move it: ' + ((r && r.err) || 'unknown')); };
}
function cur() { return snap.sessions.find(s => s.sid === selected); }

// one path for every session: in-app terminal, Terminal.app tab, or a session on the other machine (peer)
function sessSend(s, text) {
  if (s.onPeer) return window.api.peer.send(s.sid, text);
  return s.owner ? window.api.ctl.send(s.owner, text, true) : window.api.ext.send(s.tty, text);
}
function sessInterrupt(s) {
  if (s.onPeer) return window.api.peer.interrupt(s.sid);
  return s.owner ? window.api.pty.write(s.owner, '\x1b') : window.api.ext.interrupt(s.tty);
}
const peerTag = s => s.onPeer ? `<span class="tag peer" title="Runs on ${esc(s.hostLabel)}">${esc(s.hostLabel)}${s.offline ? ' · offline' : ''}</span>`
  : s.hostLabel ? `<span class="tag peer" title="Runs on this machine (${s.owner ? 'in-app' : s.kind === 'bg' ? 'background' : 'Terminal'})">${esc(s.hostLabel)}</span>` : '';

// bubble colour picker: Auto (by model) + the five palettes in organism.js (PICK_COLORS)
const swatchBg = P => P.rim;                                   // flat sample of the colour (its rim), no 3-D shading
function colorSwatches(s) {
  const auto = `<button class="sw ${s.color ? '' : 'on'}" data-color="" title="Automatic — by model" style="background:conic-gradient(#ff4fd8,#4fd0ff,#8dff5a,#ffb347,#ff4fd8)"><span>Auto</span></button>`;
  return auto + PICK_COLORS.map(k => `<button class="sw ${s.color === k ? 'on' : ''}" data-color="${k}" title="${ORB_PAL[k].name}" style="background:${swatchBg(ORB_PAL[k])}"><span>${ORB_PAL[k].name}</span></button>`).join('');
}
document.addEventListener('click', e => {
  const b = e.target.closest('.swatches .sw'); if (!b) return;
  const s = cur(); if (!s) return;
  const key = b.dataset.color || null;
  window.api.setColor(s.sid, key);
  s.color = key || undefined;                                             // show it right away; the next snapshot confirms
  const n = viz.nodes.get(s.sid); if (n) n.s.color = s.color;
  renderPanel();
});
function renderPanel() {
  if (!selected) return;
  const s = cur(), box = $('#pStatic'); if (!box) return;
  if (!s) { box.innerHTML = `<div class="ph"><div class="row1"><h2>Session ended</h2><button class="close" id="pClose">×</button></div></div>`; $('#pClose').onclick = () => select(null); return; }
  const logEl = box.querySelector('.log');
  const stick = !logEl || logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 8;
  const ctxPct = s.ctxMax ? s.ctx / s.ctxMax * 100 : 0;
  const col = FAMILY_COLOR[s.family];
  const mtok = v => (v.in || 0) + (v.out || 0) + (v.cr || 0) + (v.cw || 0);
  const models = Object.entries(s.byModel).sort((a, b) => mtok(b[1]) - mtok(a[1]));
  const maxTok = Math.max(...models.map(m => mtok(m[1])), 1);
  box.innerHTML = `
  <div class="ph"><div class="row1"><span class="hdot h-${s.health}"></span><h2 title="${esc(s.name)}">${esc(s.name)}</h2><button class="close" id="pClose">×</button></div>
    <div class="meta"><span style="color:${col}">${esc(s.model || 'no model yet')}</span><span>${s.health}${s.status && s.status !== 'busy' && s.status !== 'idle' ? ' (' + esc(s.status) + ')' : ''}</span>
    <span>pid ${s.pid}</span><span>${s.tty ? s.tty.replace('/dev/', '') : 'no tty'}</span><span>${s.onPeer ? 'on ' + esc(s.hostLabel) : s.owner ? 'in-app' : s.kind === 'bg' ? 'background' : 'Terminal.app'}</span>
    ${s.remote ? '<span>remote-control on</span>' : ''}<span>v${esc(s.version)}</span><span title="${esc(s.cwd)}">${esc(s.cwd.replace(/^\/Users\/[^/]+/, '~'))}</span></div></div>
  <div class="sec"><h3>Bubble colour</h3><div class="swatches">${colorSwatches(s)}</div></div>
  <div class="sec"><h3>Live</h3><div class="kpis">
    <div class="kpi"><div class="l">Speed now</div><div class="v">${Math.round(s.tps)} <small>tok/s</small></div></div>
    <div class="kpi"><div class="l">Last reply</div><div class="v">${Math.round(s.lastSpeed)} <small>tok/s</small></div></div>
    <div class="kpi"><div class="l">Burn</div><div class="v">${fmtTok(s.tokHr)}<small>/h</small></div></div>
    <div class="kpi"><div class="l">Today</div><div class="v">${fmtTok(s.todayTok)}</div></div>
    <div class="kpi"><div class="l">Session total</div><div class="v">${fmtTok(s.totalTok)}</div></div>
    <div class="kpi"><div class="l">Errors 5m / 1h</div><div class="v" style="color:${s.errors5m ? 'var(--err)' : 'inherit'}">${s.errors5m} <small>/ ${s.errors1h}</small></div></div>
    <div class="kpi"><div class="l">Sub-agents</div><div class="v">${s.subagents}</div></div>
    <div class="kpi"><div class="l">CPU · Mem</div><div class="v">${Math.round(s.cpu)}<small>% · ${s.rssMb}MB</small></div></div>
    <div class="kpi"><div class="l">Uptime · last write</div><div class="v" style="font-size:13px">${esc(s.etime)} <small>· ${ago(s.sinceWrite)}</small></div></div>
  </div>
  <div style="margin-top:10px;font-size:12px;color:var(--dim);display:flex;justify-content:space-between"><span>Context</span><span>${fmtN(s.ctx)} / ${fmtN(s.ctxMax)} · ${ctxPct.toFixed(0)}%</span></div>
  <div class="bar"><div style="width:${Math.min(100, ctxPct)}%;background:${ctxPct > 85 ? 'var(--err)' : ctxPct > 60 ? 'var(--warn)' : col}"></div></div>
  <div style="font-size:12px;color:var(--dim);margin-top:4px">tok/s · last 5 min</div><canvas class="spark" id="spark"></canvas>
  ${s.lastError ? `<div class="note" style="color:#fca5a5">last API error: ${esc(s.lastError)}</div>` : ''}
  </div>
  <div class="sec"><h3>Tokens (session)</h3><div class="tokgrid">
    <span>Input</span><span>${fmtN(s.tokIn)}</span><span>Output</span><span>${fmtN(s.tokOut)}</span>
    <span>Cache read</span><span>${fmtN(s.tokCacheRead)}</span><span>Cache write</span><span>${fmtN(s.tokCacheWrite)}</span><span>Turns</span><span>${s.turns}</span></div>
    ${models.length > 1 ? '<h3 style="margin-top:12px">Tokens by model</h3>' + models.map(([m, v]) => `<div style="display:flex;justify-content:space-between;font-size:12px"><span>${esc(m.replace('claude-', ''))}</span><span>${fmtTok(mtok(v))}</span></div><div class="bar"><div style="width:${mtok(v) / maxTok * 100}%;background:${FAMILY_COLOR[(/fable|mythos|opus|sonnet|haiku/.exec(m) || ['other'])[0]]}"></div></div>`).join('') : ''}
  </div>
  <div class="sec"><h3>Activity</h3><div class="log">${s.log.map(l => `<div class="${l.kind}"><time>${hhmm(l.t)}</time>${l.kind === 'tool' ? '⚙ ' : l.kind === 'you' ? '› ' : ''}${esc(l.text)}</div>`).join('') || '<div>No activity yet</div>'}</div></div>`;
  $('#pClose').onclick = () => select(null);
  const lg = box.querySelector('.log'); if (stick) lg.scrollTop = lg.scrollHeight; else if (logEl) lg.scrollTop = logEl.scrollTop;
  drawSpark($('#spark'), s.spark, col, s.sparkPeak);
}

function drawSpark(c, data, col, peak) {
  const d = devicePixelRatio, w = c.clientWidth, h = c.clientHeight;
  c.width = w * d; c.height = h * d;
  const x = c.getContext('2d'); x.scale(d, d);
  // steady scale: a 'nice' ceiling over the last 15 min's peak, so past spikes keep their height
  const top = Math.max(10, peak || 0, ...data), mag = Math.pow(10, Math.floor(Math.log10(top))), max = [1, 2, 2.5, 5, 10].map(k => k * mag).find(v => v >= top);
  x.strokeStyle = 'rgba(255,255,255,.06)'; x.beginPath(); x.moveTo(0, h - .5); x.lineTo(w, h - .5); x.stroke();
  const pts = data.map((v, i) => [i / (data.length - 1) * w, h - 4 - v / max * (h - 10)]);
  const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, col + '66'); g.addColorStop(1, col + '00');
  x.fillStyle = g; x.beginPath(); x.moveTo(0, h); pts.forEach(p => x.lineTo(...p)); x.lineTo(w, h); x.fill();
  x.strokeStyle = col; x.lineWidth = 1.5; x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(...p) : x.moveTo(...p)); x.stroke();
  x.fillStyle = '#8a93ab'; x.font = '10px -apple-system'; x.fillText(Math.round(max) + ' tok/s', 4, 11);
}

// Controls stay mounted while stats re-render, so typing isn't interrupted.
// ---------------- move a session to the other Mac (main.js → handoff.js) ----------------
// shown when the other Mac is paired and online, for a session that runs (or ran) in a terminal, not a background agent
const canMove = s => !!(s && snap.peer && snap.peer.online && window.api.handoff && s.kind !== 'bg' && (s.onPeer ? !s.offline : true));
async function moveSession(s) {
  const to = s.onPeer ? 'this Mac' : snap.peer.label, nm = s.name || s.sid.slice(0, 8);
  if (s.health === 'working' && !confirm(`${nm} is in the middle of a turn. Moving stops it now and resumes it on ${to}. Move anyway?`)) return;
  toast(`Moving ${nm} to ${to}…`);
  const r = await window.api.handoff.move(s.remoteSid || s.sid);
  if (r && r.ok) toast(`${nm} now runs on ${to}`);
  else toast(`Couldn't move ${nm}: ${(r && r.err) || 'failed'}${r && r.restartedHere ? ' — it was restarted here' : ''}`);
}
if (window.api.handoff) {
  window.api.handoff.onProgress(p => { const s = snap.sessions.find(x => x.sid === p.sid); toast(`${(s && s.name) || 'Session'} → ${p.to}: ${p.stage}${p.pct != null ? ' ' + p.pct + '%' : ''}`); });
  // a session moved here (or restarted here after a failed move): a fresh in-app terminal resuming it
  window.api.handoff.onStart(async x => {
    if (document.body.dataset.view === 'mesh') setView('split');
    const id = await newTerm({ kind: 'claude', cwd: x.cwd, flags: `${RESUME_FLAGS} --resume ${x.sid}`, title: (x.name || x.sid.slice(0, 8)).slice(0, 40) });
    autoTrust.set(id, { until: Date.now() + 20000, buf: '' });
    toast(`Resumed ${x.name || 'session'} here`);
  });
}

function renderCtl() {
  const s = cur(); const box = $('#pCtl'); if (!box || !s) return;
  const peer = !!s.onPeer, live = peer ? !s.offline && (s.owner || (s.tty && s.kind !== 'bg')) : false;
  const owned = !peer && !!s.owner, ext = !peer && !owned && s.tty && s.kind !== 'bg';
  box.innerHTML = `<div class="sec ctl"><h3>Control</h3>
    <textarea id="cText" placeholder="${owned || ext || live ? 'Type a prompt… drop files or ⌘V images to attach (⌘↩ to send)' : 'This session has no terminal the app can reach'}"></textarea>
    <div class="btns">
      <button class="primary" id="cSend">Send</button>
      <button id="cEsc" title="Send Esc (interrupt the current turn)">Interrupt</button>
      <button id="cCompact">/compact</button>
      ${peer ? (s.owner && terms.has(s.owner) ? '<button id="cFocus">Show terminal</button>' : '') : `<button id="cFocus">${owned || s.pane ? 'Show terminal' : 'Focus in Terminal'}</button>`}
      ${canMove(s) ? `<button id="cMove" title="Stop it here, copy it to the other Mac and resume it there">⇄ ${peer ? 'Move to this Mac' : 'Move to ' + esc(snap.peer.label)}</button>` : ''}
      ${owned ? '<button class="danger" id="cKill">Kill</button>' : ''}
    </div>
    <div class="note">${peer ? (live ? `Runs on ${esc(s.hostLabel)}: prompts are passed to it over Tailscale.` : `${esc(s.hostLabel)} is offline or this session can’t be reached.`) : owned ? 'Runs inside ${APP_NAME} — keystrokes go straight to its terminal.' :
      ext && s.pane ? 'Runs in a tmux pane on this Mac (keeps running when ' + APP_NAME + ' restarts). Prompts are typed into it with tmux send-keys.' :
      ext ? 'Lives in a Terminal.app window. Prompts are typed into that tab via AppleScript (first use asks for Automation permission). Multi-line text is sent as one line.' :
      'Background job — view only.'}</div></div>`;
  const send = async (text) => {
    const s = cur(); if (!s || !text) return;
    let r;
    if (s.onPeer || s.owner || s.tty) r = await sessSend(s, text);
    if (r && (r.ok === false || r.out === 'notfound')) toast(r.out === 'notfound' ? 'No Terminal.app tab found for ' + s.tty : 'Send failed: ' + (r.err || ''));
    else { viz.command(s.sid); toast('Sent to ' + s.name); }
  };
  $('#cSend').onclick = () => { const v = $('#cText').value.trim(); if (v) { send(v); $('#cText').value = ''; } };
  const ta = $('#cText');
  const insertAt = t => { const a = ta.selectionStart, b = ta.selectionEnd; ta.value = ta.value.slice(0, a) + t + ta.value.slice(b); ta.selectionStart = ta.selectionEnd = a + t.length; ta.focus(); };
  ta.addEventListener('paste', async e => {
    const types = [...(e.clipboardData?.types || [])];
    if (types.includes('text/plain') && !types.includes('Files')) return;   // plain text: default paste
    e.preventDefault(); const r = await clipboardInsert(); if (r.text) insertAt(r.text);
  });
  wireDrop(ta, insertAt);
  $('#cText').onkeydown = e => { if (e.key === 'Enter' && e.metaKey) { e.preventDefault(); $('#cSend').click(); } };
  $('#cCompact').onclick = () => send('/compact');
  $('#cEsc').onclick = async () => {
    const s = cur(); if (!s) return;
    if (s.onPeer || s.owner || s.tty) await sessInterrupt(s);
    viz.command(s.sid); toast('Interrupt sent');
  };
  if (peer && $('#cFocus')) $('#cFocus').onclick = () => { if (document.body.dataset.view === 'mesh') setView('split'); activate(s.owner); };
  if (!peer) $('#cFocus').onclick = async () => {
    const s = cur(); if (!s) return;
    if (termOf(s) && terms.has(termOf(s))) { if (document.body.dataset.view === 'mesh') setView('split'); activate(termOf(s)); }
    else if (s.tty) {
      const r = await window.api.ext.focus(s.tty);
      if (r.out === 'notfound') adoptSession(s);                                   // no window to show it in: offer to bring it into Mesh
    }
  };
  if (owned) $('#cKill').onclick = () => { window.api.pty.kill(s.owner); toast('Killed'); };
  if ($('#cMove')) $('#cMove').onclick = () => moveSession(s);
  if (!owned && !ext && !live) for (const id of ['#cSend', '#cEsc', '#cCompact', '#cFocus', '#cText']) if ($(id)) $(id).disabled = true;
}

// ---------------- broadcast (click the core) ----------------
function openBroadcast() {
  const targets = snap.sessions.filter(s => !s.offline && (s.owner || (s.tty && s.kind !== 'bg')));
  modal(`<h2>Broadcast to sessions</h2>
    ${targets.length ? `<div class="btns" style="justify-content:flex-start;margin:0 0 8px"><button id="bAll">Select all</button><button id="bLive" title="Only the sessions that are working right now">Live sessions only</button></div>` : ''}
    <div class="blist">${targets.map(s => `<label class="chk"><input type="checkbox" data-sid="${s.sid}" checked><span class="hdot h-${s.health}"></span>${esc(s.name)} <span style="color:var(--dim)">${s.health}</span></label>`).join('') || '<div class="note">No controllable sessions.</div>'}</div>
    <label>Message</label><textarea id="bText" style="width:100%;min-height:80px" placeholder="e.g. /compact  ·  give me a one-line status"></textarea>
    <div class="btns" style="justify-content:flex-end"><button id="mCancel">Cancel</button><button class="primary" id="bSend">Send to selected</button></div>`);
  const boxes = () => [...document.querySelectorAll('.blist input')], syncAll = () => { if ($('#bAll')) $('#bAll').textContent = boxes().every(i => i.checked) ? 'Select none' : 'Select all'; };
  if ($('#bAll')) {
    $('#bAll').onclick = () => { const on = !boxes().every(i => i.checked); boxes().forEach(i => i.checked = on); syncAll(); };
    $('#bLive').onclick = () => { boxes().forEach(i => { const s = targets.find(x => x.sid === i.dataset.sid); i.checked = !!s && s.health === 'working'; }); syncAll(); };
    boxes().forEach(i => i.onchange = syncAll); syncAll();
  }
  $('#bSend').onclick = async () => {
    const text = $('#bText').value.trim(); if (!text) return;
    const sids = [...document.querySelectorAll('.blist input:checked')].map(i => i.dataset.sid);
    for (const sid of sids) {
      const s = snap.sessions.find(x => x.sid === sid); if (!s) continue;
      await sessSend(s, text);
      viz.command(sid);
    }
    closeModal(); toast(`Broadcast to ${sids.length} session(s)`);
  };
}

// ---------------- new session ----------------
// the model list of the Ollama choice (New session, and switching a session)
function ollamaFill(st, sel, note, pick) {
  const opt = m => `<option value="${esc(m)}" ${m === pick ? 'selected' : ''}>${esc(m)}</option>`;
  sel.innerHTML = (st.local || []).length || (st.cloud || []).length
    ? [['On this Mac', st.local || []], ['Ollama cloud', st.cloud || []]].filter(([, L]) => L.length).map(([t, L]) => `<optgroup label="${t}">${L.map(opt).join('')}</optgroup>`).join('')
    : `<option value="">${st.installed ? 'No models found' : 'Ollama not installed'}</option>`;
  note.textContent = !st.installed ? 'Install Ollama from ollama.com/download, then open this again.' : !st.running ? "Ollama isn't running. Open the Ollama app, then open this again."
    : !st.signedIn ? 'Cloud models need a sign-in: run ollama signin in a terminal once. Local models work without it.' : 'Remote Control stays off for these sessions: it needs a Claude login.';
}
async function openNew() {
  const home = await window.api.home();
  const last = store.get('newOpts', { kind: 'claude', cwd: home, flags: '--dangerously-skip-permissions --remote-control', model: '', engine: 'claude', ollamaModel: '' });
  modal(`<h2>New session</h2>
    <div class="choice"><button data-k="claude">Claude Code</button><button data-k="hermes">Hermes Agent</button><button data-k="shell">Shell</button></div>
    <label>Working directory</label><div class="row"><input type="text" id="nCwd" value="${esc(last.cwd)}"><button id="nBrowse" style="flex:none">Browse…</button></div>
    <div id="nOrchRow"><label>Project <span id="nOrchRoot" class="pdim"></span> runs on</label><div class="choice" id="nOrch"><button data-o="claude">Claude Code</button><button data-o="hermes">Hermes</button></div>
      <div class="pdim" id="nOrchNote" style="margin-top:6px"></div></div>
    <div id="nClaude">
      <label>Runs on</label><div class="choice" id="nEngine"><button data-e="claude">Claude</button><button data-e="ollama">Ollama</button></div>
      <div id="nOllama" style="display:none"><label>Open model</label><select id="nOlModel" style="width:100%"><option value="">Checking Ollama…</option></select><div class="pdim" id="nOlNote" style="margin-top:6px"></div></div>
      <div id="nClaudeModel"><label>Model</label><select id="nModel" style="width:100%">
        ${[['', 'Default'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku'], ['claude-fable-5-1', 'Fable 5.1']].map(([v, l]) => `<option value="${v}" ${v === last.model ? 'selected' : ''}>${l}</option>`).join('')}
      </select></div>
      <label>Flags</label><input type="text" id="nFlags" value="${esc(last.flags)}">
      <label class="chk"><input type="checkbox" id="nResume"> Resume a previous session (--resume picker)</label>
    </div>
    <div id="nHermesBox" style="display:none"><label>Session name</label><input type="text" id="nHName" placeholder="Hermes · folder">
      <div id="nHermes" class="pdim" style="margin-top:8px">Checking Hermes Agent…</div></div>
    <div class="btns" style="justify-content:flex-end"><button id="mCancel">Cancel</button><button class="primary" id="nGo">Start</button></div>`);
  let kind = last.kind, hermes = null;
  let orch = { orchestrator: 'claude' }, onPeer = false;
  const setKind = k => {
    if (orch.orchestrator === 'hermes' && k === 'claude') k = 'hermes';          // the project runs on Hermes: no Claude session in it
    kind = k; document.querySelectorAll('.choice button[data-k]').forEach(b => { b.classList.toggle('on', b.dataset.k === k); if (b.dataset.k === 'claude') b.disabled = orch.orchestrator === 'hermes'; });
    $('#nClaude').style.display = k === 'claude' ? '' : 'none'; $('#nHermesBox').style.display = k === 'hermes' ? '' : 'none'; if (k === 'hermes') heLoad(); olPick();
  };
  // Hermes Agent sessions run in tmux on a Mac with the Ollama app; the MacBook starts them on the other Mac when it can't
  const heLoad = async () => {
    const here = await window.api.hermesHere().catch(() => false), peerOk = !!(snap && snap.peer && snap.peer.online);
    onPeer = !here && peerOk; hermes = here || peerOk;
    const where = onPeer ? ` It runs on ${esc((snap.peer && snap.peer.label) || 'the other Mac')}, which has the Ollama app, and shows here as a mirror.` : '';
    if ($('#nHermes')) { $('#nHermes').innerHTML = hermes ? `Runs on DeepSeek V4 Pro through Ollama (no Claude), in tmux, so it survives Mesh updates. Pasted and dropped images go to the vision models.${where}` : "Hermes Agent needs the Ollama app on this Mac, or the other Mac online."; olPick(); }
  };
  // which agent runs the project of this folder (<project>/.mesh.json): Kevin's switch, shared by both Macs
  const orchLoad = async () => {
    const cwd = $('#nCwd').value.trim() || home;
    orch = await window.api.orchestrator.get(cwd, false).catch(() => ({ orchestrator: 'claude' }));
    if (!orch.root && snap && snap.peer && snap.peer.online) { const r = await window.api.orchestrator.get(cwd.replace(home, '~'), true).catch(() => null); if (r && r.root) orch = { ...r, viaPeer: true }; }
    $('#nOrchRow').style.display = orch.root ? '' : 'none';
    $('#nOrchRoot').textContent = orch.rootTilde || (orch.root || '').replace(home, '~');
    document.querySelectorAll('#nOrch button').forEach(b => b.classList.toggle('on', b.dataset.o === orch.orchestrator));
    $('#nOrchNote').textContent = orch.orchestrator === 'hermes' ? 'New sessions, scheduled jobs and relays for this project run only through Hermes and Ollama.' : '';
    if (!$('#nHName').value) $('#nHName').placeholder = 'Hermes · ' + (cwd.split('/').pop() || '~');
    setKind(orch.orchestrator === 'hermes' ? 'hermes' : kind);
  };
  document.querySelectorAll('#nOrch button').forEach(b => b.onclick = async () => {
    const r = await window.api.orchestrator.set(($('#nCwd').value.trim() || home).replace(orch.viaPeer ? home : '\0', '~'), b.dataset.o, !!orch.viaPeer).catch(e => ({ ok: false, err: e.message }));
    if (r && r.ok === false) toast("Couldn't change it: " + (r.err || 'unknown')); else { toast(`${orch.rootTilde || 'Project'} now runs on ${b.dataset.o === 'hermes' ? 'Hermes' : 'Claude Code'}`); if (b.dataset.o === 'hermes') kind = 'hermes'; }
    orchLoad();
  });
  $('#nCwd').addEventListener('change', orchLoad);
  document.querySelectorAll('.choice button[data-k]').forEach(b => b.onclick = () => setKind(b.dataset.k));
  // Claude, or an open model through Ollama: same Claude Code, same terminal
  let engine = last.engine === 'ollama' ? 'ollama' : 'claude', ollama = null;
  const olPick = () => { const go = $('#nGo'); if (go) go.disabled = kind === 'claude' && engine === 'ollama' && !$('#nOlModel').value || kind === 'hermes' && !hermes; };
  const olLoad = async () => { ollama = await window.api.ollamaStatus().catch(() => ({ installed: false })); if ($('#nOlModel')) { ollamaFill(ollama, $('#nOlModel'), $('#nOlNote'), last.ollamaModel); olPick(); } };
  const setEngine = e => { engine = e; document.querySelectorAll('#nEngine button').forEach(b => b.classList.toggle('on', b.dataset.e === e)); $('#nOllama').style.display = e === 'ollama' ? '' : 'none'; $('#nClaudeModel').style.display = e === 'ollama' ? 'none' : ''; if (e === 'ollama' && !ollama) olLoad(); olPick(); };
  document.querySelectorAll('#nEngine button').forEach(b => b.onclick = () => setEngine(b.dataset.e)); setEngine(engine);
  $('#nOlModel').onchange = olPick; setKind(kind);
  $('#nBrowse').onclick = async () => { const d = await window.api.pickDir(); if (d) { $('#nCwd').value = d; orchLoad(); } };
  orchLoad();
  $('#nGo').onclick = async () => {
    const o = { kind, cwd: $('#nCwd').value.trim() || home, flags: $('#nFlags').value.trim(), model: $('#nModel').value, engine, ollamaModel: engine === 'ollama' ? $('#nOlModel').value : last.ollamaModel };
    store.set('newOpts', o); const useOl = kind === 'claude' && engine === 'ollama';
    if (kind === 'hermes') {
      const name = $('#nHName').value.trim() || $('#nHName').placeholder; closeModal();
      const r = await window.api.hermesNew({ cwd: onPeer ? o.cwd.replace(home, '~') : o.cwd, name, onPeer });
      if (!r || r.ok === false) return toast("Couldn't start Hermes: " + ((r && r.err) || 'unknown'));
      return newTerm({ adopt: { id: r.id, title: r.title, pane: true }, kind: 'hermes' });
    }
    let flags = o.flags + (o.model && !useOl ? ` --model ${o.model}` : '') + ($('#nResume').checked ? ' --resume' : '');
    closeModal();
    await newTerm({ kind, cwd: o.cwd, flags, ...(useOl ? { engine: 'ollama', ollamaModel: o.ollamaModel } : {}), title: kind === 'claude' ? (useOl ? o.ollamaModel + ' · starting' : 'claude · starting') : kind === 'hermes' ? 'Hermes Agent' : o.cwd.split('/').pop() || '~' });
  };
}

function modal(html) {
  $('#modalCard').classList.remove('wide'); $('#modalCard').innerHTML = html; $('#modal').classList.remove('hidden'); const c = $('#mCancel'); if (c) c.onclick = closeModal;
  // a soft spring in (anime.js); none in Simple mode
  if (window.anime && !isSimple()) { anime.remove('#modalCard'); anime.animate('#modalCard', { opacity: [0, 1], scale: [.965, 1], translateY: [10, 0], ease: anime.createSpring({ stiffness: 320, damping: 26 }) }); }
}
function closeModal() { $('#modal').classList.add('hidden'); }
$('#modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };

// ---------------- paste / drop of files & images ----------------
// Paths are backslash-escaped exactly like Terminal.app does on drag-and-drop, so Claude Code
// turns image paths into [Image #n] attachments and other files into @-mentionable paths.
const shq = p => p.replace(/([\s\\'"()&;|<>$`!*?#~{}\[\]])/g, '\\$1');
const droppedPaths = e => [...(e.dataTransfer?.files || [])].map(f => window.api.pathForFile(f)).filter(Boolean);
async function clipboardInsert(peer) {
  const c = await window.api.clipRead();
  if (c.kind === 'files') {
    if (peer) {                                                  // the session runs on the other machine: send the files there
      const u = await window.api.peer.upload(c.paths);
      if (u.err) { toast("Couldn't send the file: " + u.err); return { text: '', files: true }; }
      c.paths = u.paths;
    }
    if (c.image) toast('Image pasted as ' + c.paths[0].split('/').pop()); return { text: c.paths.map(shq).join(' ') + ' ', files: true };
  }
  return { text: c.text || '', files: false };
}
function wireDrop(el, insert) {
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('dropping'); });
  el.addEventListener('dragleave', () => el.classList.remove('dropping'));
  el.addEventListener('drop', e => {
    e.preventDefault(); el.classList.remove('dropping');
    const ps = droppedPaths(e); if (ps.length) insert(ps.map(shq).join(' ') + ' ');
  });
}

// ---------------- terminals ----------------
// OSC 52 = a program asking the terminal to set the clipboard. Claude Code copies its own mouse selections this
// way ("sent N chars via OSC 52"). Only the window being used takes it: a session shared with the other machine
// prints the same sequence into both windows, and copying on one Mac must not overwrite the other's clipboard.
function wireOsc52(term) {
  term.parser.registerOscHandler(52, data => {
    const b64 = data.slice(data.indexOf(';') + 1);
    if (!b64 || b64 === '?' || !document.hasFocus()) return true;
    try { window.api.clipWrite(new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)))); } catch { }
    return true;
  });
}
const termOpts = () => ({
  fontFamily: '"SF Mono", Menlo, monospace', fontSize: 12.5, lineHeight: 1.15, cursorBlink: !isSimple(), allowProposedApi: true,
  macOptionIsMeta: true, macOptionClickForcesSelection: true, scrollback: 20000,   // ⌥-drag = the terminal's own selection (⌘C) even when Claude Code has the mouse
  theme: { background: '#06051a', foreground: '#e6e9f2', cursor: '#a78bfa', selectionBackground: '#3b4a7a88',
    black: '#1b1f2a', brightBlack: '#555e78', blue: '#7aa2f7', brightBlue: '#9ab8ff', magenta: '#bb9af7', cyan: '#2dd4bf', green: '#34d399', red: '#f87171', yellow: '#fbbf24' },
});

// Live mirrors of the other machine's in-app terminals (peer:… ids). They keep the host's size — the
// text is scaled to fit instead — and keystrokes go back to the host. Closing a mirror only detaches it.
const peerClosed = new Set();
function syncPeerTerms() {
  const want = new Map((snap.ptys || []).filter(p => p.onPeer || p.kind === 'tmux').map(p => [p.id, p]));   // the peer's terminals + our tmux panes
  for (const [id, p] of want) {
    if (peerClosed.has(id)) continue;
    let t = terms.get(id);
    if (!t) t = mirrorTerm(p);
    if (!t.attached) { t.attached = true; window.api.peerTerm.open(id); }
  }
  for (const [id, t] of terms) if (t.peer && !want.has(id)) { window.api.peerTerm.close(id); t.stamps && t.stamps.dispose(); t.term.dispose(); t.el.remove(); terms.delete(id); if (activeTerm === id) activeTerm = null; renderTabs(); layoutGrid(); }
  for (const id of peerClosed) if (!want.has(id)) peerClosed.delete(id);
  $('#noTerms').style.display = terms.size ? 'none' : '';
}
// the time column beside prompts / replies (term-stamps.js): which session a terminal belongs to
const sidForTerm = id => ((snap && snap.sessions) || []).find(s => s.owner === id || s.pane === id)?.sid || null;
const addStamps = (term, el, id) => {
  if (!window.attachTermStamps) return null;
  const h = window.attachTermStamps(term, el.querySelector('.xt'), { sid: () => sidForTerm(id), fetch: s => window.api.stamps(s) });
  // the column narrows the terminal: measure it again (own terminals refit; a mirror rescales its text)
  requestAnimationFrame(() => { const t = terms.get(id); if (!t) return; try { t.peer ? fitScaled(t) : t.fit.fit(); } catch { } });
  return h;
};
function mirrorTerm(p) {
  const el = document.createElement('div'); el.className = 'term peer';
  el.innerHTML = `<div class="tlabel"><span class="hdot h-idle"></span><span class="ttl"></span></div><div class="xt"></div>`;
  $('#terms').appendChild(el);
  const term = new Terminal(termOpts());
  const fit = new FitAddon.FitAddon(); term.loadAddon(fit);
  term.open(el.querySelector('.xt'));
  wireOsc52(term);
  // only real keystrokes go back: xterm's automatic replies to terminal queries (device attributes, cursor
  // position, focus, colour reports) are already answered by the host's own terminal, and would land as typed text
  const isReport = d => /^\x1b\[[?>=]?[\d;]*[cnRtIOy]$/.test(d) || /^\x1b\[[IO]$/.test(d) || d.startsWith('\x1b]') || d.startsWith('\x1bP');
  term.onData(d => { if (!isReport(d)) window.api.pty.write(p.id, d); });
  // our own tmux panes use this view too: their files stay on this machine; only the other machine's terminals get an upload
  el.addEventListener('paste', async e => { e.preventDefault(); e.stopPropagation(); const r = await clipboardInsert(!!p.onPeer); if (r.text) term.paste(r.text); }, true);
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('dropping'); });
  el.addEventListener('dragleave', () => el.classList.remove('dropping'));
  el.addEventListener('drop', async e => {
    e.preventDefault(); el.classList.remove('dropping');
    const ps = droppedPaths(e); if (!ps.length) return;
    if (!p.onPeer) { term.paste(ps.map(shq).join(' ') + ' '); term.focus(); return; }
    const u = await window.api.peer.upload(ps);
    if (u.err) return toast("Couldn't send the file: " + u.err);
    term.paste(u.paths.map(shq).join(' ') + ' '); term.focus();
  });
  term.textarea && term.textarea.addEventListener('focus', () => { activeTerm = p.id; markFocus(); });
  const t = { term, fit, el, title: p.title, kind: p.kind, peer: true, local: !p.onPeer, cols: 120, rows: 30, driving: false, stamps: addStamps(term, el, p.id) };
  terms.set(p.id, t);
  if (!activeTerm) { activeTerm = p.id; el.classList.add('on'); }   // the active terminal is also the one shown (it used to stay hidden: clicking its session then did nothing)
  renderTabs(); layoutGrid();
  return t;
}
// A terminal shared with the other machine has one size. Whichever window was used last sets it (keys, clicks,
// scrolling, focus): its panes fit normally and the session rewraps; the other side keeps that grid and scales
// the text to fit, so nothing re-wraps wrong there.
const BASE_FONT = termOpts().fontSize;
function fitScaled(t) {
  // always the given grid, even while the tab is hidden: output written at another width wraps wrong for good
  if (!t.sizing && (t.term.cols !== t.cols || t.term.rows !== t.rows)) t.term.resize(t.cols, t.rows);
  const box = t.el.querySelector('.xt'), w = box.clientWidth - 12 - (t.stamps ? 40 : 0), h = box.clientHeight - 6; if (w <= 0 || h <= 0) return;
  const f0 = t.term.options.fontSize, cell = t.term._core?._renderService?.dimensions?.css?.cell;   // measured cell size at f0
  const cw = cell && cell.width ? cell.width / f0 : .602, ch = cell && cell.height ? cell.height / f0 : 1.15 * 1.18;
  const fs = Math.max(7, Math.min(BASE_FONT, w / (t.cols * cw), h / (t.rows * ch)));
  if (Math.abs(f0 - fs) > .05) t.term.options.fontSize = fs;
}
const termVisible = t => document.body.dataset.view === 'grid' || t.el.classList.contains('on');
// change a terminal's grid at this point in its output, not ahead of what is still queued for the old size
function gridInLine(t, cols, rows) {
  flushTerm(t); t.sizing = (t.sizing || 0) + 1;
  t.term.write('', () => { t.sizing--; if (t.term.cols !== cols || t.term.rows !== rows) t.term.resize(cols, rows); if (!t.driving) fitScaled(t); });
}
// this window's own size for a terminal; a mirror also asks the host to resize the session to it
function fitOwn(id, t) {
  if (t.term.options.fontSize !== BASE_FONT) t.term.options.fontSize = BASE_FONT;
  if (!t.peer) return t.fit.fit();
  const box = t.el.querySelector('.xt'); if (box.clientWidth < 200 || box.clientHeight < 80) return;   // not laid out yet
  const d = t.fit.proposeDimensions(); if (!d || !(d.cols >= 20) || !(d.rows >= 5)) return;
  t.cols = Math.max(20, d.cols); t.rows = Math.max(5, d.rows);
  // only ask here: the grid changes when the answer comes back in the output stream (gridInLine), because the bytes still on
  // their way were written for the old width and would land wrong, which leaves overlapping text
  if (t.sentCols !== t.cols || t.sentRows !== t.rows) {
    t.sentCols = t.cols; t.sentRows = t.rows; (t.asked = t.asked || []).push(`${t.cols}x${t.rows}`); window.api.peerTerm.resize(id, t.cols, t.rows);
    // no confirmation (host offline, or a build that can't resize): show the host's real size again
    clearTimeout(t.confirmT);
    t.confirmT = setTimeout(() => { if (t.driving && (t.hostCols !== t.cols || t.hostRows !== t.rows)) { t.driving = false; t.noClaimUntil = Date.now() + 60000; t.sentCols = t.sentRows = 0; t.cols = t.hostCols || t.cols; t.rows = t.hostRows || t.rows; fitScaled(t); } }, 2000);
  }
}
function fitTerm(id, t) { flushTerm(t); (t.peer ? t.driving : !t.remote) ? fitOwn(id, t) : fitScaled(t); }
let lastUse = 0;
const peerCanResize = () => !!(snap.peer && snap.peer.online && (snap.peer.caps || []).includes('resize'));
function windowUsed(e) {
  if (!e.isTrusted || document.body.dataset.size === 'mini') return;   // real input only; the compact window never takes the size
  // never while copying: ⌘-shortcuts and bare modifier keys don't count, a click counts only once released without
  // selecting, and nothing is resized while text is selected (a resize clears the selection and Claude Code redraws)
  if (e.type === 'keydown' && (e.metaKey || ['Meta', 'Shift', 'Alt', 'Control', 'CapsLock'].includes(e.key))) return;
  for (const [, t] of terms) if (t.term.hasSelection()) return;
  if (e.type === 'mouseup' && (getSelection() || '').toString()) return;
  if (Date.now() - lastUse < 700) return; lastUse = Date.now();
  for (const [id, t] of terms) {
    if (!termVisible(t)) continue;
    // a host build that can't resize (or didn't confirm a minute ago) is left alone: asking again would flip the size back and forth
    if (t.peer && !t.driving && (t.local || peerCanResize()) && !(t.noClaimUntil > Date.now())) { t.driving = true; t.sentCols = t.sentRows = 0; fitOwn(id, t); }
    else if (!t.peer && t.remote) { t.remote = false; fitOwn(id, t); }
  }
}
// (not window focus: bringing the app to the front — e.g. `open` over ssh — is not using it)
['keydown', 'mouseup', 'wheel'].forEach(ev => addEventListener(ev, windowUsed, true));
// the other machine took the size of one of our terminals
window.api.peerTerm.onRemoteSize((id, c, r) => { const t = terms.get(id); if (!t || t.peer) return; t.remote = true; t.cols = c; t.rows = r; gridInLine(t, c, r); });
// the exact current screen (+ recent scrollback) of one of our terminals, for a phone or the peer opening it
window.api.termSnap.onRequest((rq, id) => {
  const t = terms.get(id);
  if (!t || !t.ser) return window.api.termSnap.reply(rq, null);
  // wait until everything written before this request is parsed — output after it is streamed separately
  flushTerm(t); const seq = t.seq || 0;                            // the last output this snapshot will hold
  t.term.write('', () => { let out = null; try { out = t.ser.serialize({ scrollback: 1500 }); } catch { } window.api.termSnap.reply(rq, out, seq); });
});
window.api.peerTerm.onInit((id, i) => {
  const t = terms.get(id); if (!t) return;
  t.inited = true; t.cols = t.hostCols = i.cols; t.rows = t.hostRows = i.rows; t.sizing = 0; t.asked = []; t.term.reset(); t.term.options.fontSize = BASE_FONT; fitScaled(t);
  t.term.write(i.backlog || '', () => requestAnimationFrame(() => { if (!terms.has(id)) return; try { fitScaled(t); t.term.refresh(0, t.term.rows - 1); } catch { } }));   // draw the first screen even if it landed before the tab was laid out
  if (t.driving) { t.sentCols = t.sentRows = 0; fitOwn(id, t); }   // reconnected while this window had the size: ask again
});
window.api.peerTerm.onSize((id, i) => {
  const t = terms.get(id); if (!t) return;
  t.hostCols = i.cols; t.hostRows = i.rows;
  const asked = t.driving && t.asked ? t.asked.indexOf(`${i.cols}x${i.rows}`) : -1;
  if (asked >= 0) t.asked.splice(0, asked + 1);                       // our own request, confirmed (a newer one may be on its way)
  else if (!(t.driving && i.cols === t.cols && i.rows === t.rows)) { t.driving = false; t.cols = i.cols; t.rows = i.rows; }   // the host (or a phone) set another size
  gridInLine(t, i.cols, i.rows);
});
window.api.peerTerm.onClosed(id => { const t = terms.get(id); if (t) { t.attached = false; t.inited = false; } });   // reconnects on the next telemetry tick
// a session stays on the engine you put it on, also when it's resumed later: { sid: ollama model }
function engineFor(opts) {
  const sid = (/--resume\s+(\S+)/.exec(opts.flags || '') || [])[1]; if (!sid) return opts;
  const map = store.get('sessEngine', {});
  if (opts.engine === 'ollama') { map[sid] = opts.ollamaModel; store.set('sessEngine', map); return opts; }
  if (opts.engine === 'claude') { delete map[sid]; store.set('sessEngine', map); return opts; }
  return map[sid] ? { ...opts, engine: 'ollama', ollamaModel: map[sid] } : opts;
}
async function newTerm(opts) {
  opts = engineFor(opts);
  if (document.body.dataset.view === 'mesh') setView('split');
  const info = opts.adopt || await window.api.pty.spawn({ ...opts, cols: 120, rows: 30 });
  if (!info || !info.id) { toast("Couldn't start it: " + ((info && info.err) || 'unknown')); return null; }
  if (info.pane) {                                                 // it lives in tmux: this tab is a view of it, like any other pane
    const t = terms.get(info.id) || mirrorTerm({ id: info.id, title: info.title, kind: 'tmux' });
    if (!t.attached) { t.attached = true; window.api.peerTerm.open(info.id); }
    t.driving = true; t.sentCols = t.sentRows = 0;
    activate(info.id); if (isMini()) miniShow('term');
    return info.id;
  }
  const el = document.createElement('div'); el.className = 'term';
  el.innerHTML = `<div class="tlabel"><span class="hdot h-idle"></span><span class="ttl"></span></div><div class="xt"></div>`;
  $('#terms').appendChild(el);
  const term = new Terminal(termOpts());
  const fit = new FitAddon.FitAddon(); term.loadAddon(fit);
  const ser = new SerializeAddon.SerializeAddon(); term.loadAddon(ser);
  term.open(el.querySelector('.xt'));
  wireOsc52(term);
  term.onData(d => window.api.pty.write(info.id, d));
  // ⌘V: Finder-copied files → their paths, screenshot/image → saved PNG path, else plain text.
  // (Ctrl+V still goes straight to Claude Code, which reads image clipboards itself.)
  el.addEventListener('paste', async e => {
    e.preventDefault(); e.stopPropagation();
    const r = await clipboardInsert(); if (r.text) term.paste(r.text);
  }, true);
  wireDrop(el, text => { term.paste(text); term.focus(); });
  term.onResize(({ cols, rows }) => window.api.pty.resize(info.id, cols, rows));
  term.textarea && term.textarea.addEventListener('focus', () => { activeTerm = info.id; markFocus(); });
  terms.set(info.id, { term, fit, ser, el, title: info.title, kind: opts.kind, stamps: addStamps(term, el, info.id) });
  if (opts.saved) term.write(opts.saved, () => window.api.update.adopted(info.id));
  $('#noTerms').style.display = 'none';
  activate(info.id); if (isMini()) miniShow('term');
  return info.id;
}

// A terminal nobody can see takes its output in batches every 2 seconds. Terminal queries still go through at once: the program waits for the answer.
const QUERY = /\x1b\[[?>]?[\d;]*[cn]|\x1b\][\d;]*;\?|\x1bP/;
function flushTerm(t) { clearTimeout(t.feedT); t.feedT = 0; if (t.q) { const d = t.q; t.q = ''; t.term.write(d); } }
window.api.pty.onData((id, d, seq) => {
  const t = terms.get(id); if (!t) return;
  if (seq) t.seq = seq;
  if ((termVisible(t) && !document.hidden && !viz.offscreen) || QUERY.test(d)) { flushTerm(t); t.term.write(d); return; }
  t.q = (t.q || '') + d; if (!t.feedT) t.feedT = setTimeout(() => flushTerm(t), 2000);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) for (const [, t] of terms) if (termVisible(t)) flushTerm(t); });
window.api.pty.onExit((id) => {
  const t = terms.get(id); if (!t) return;
  t.term.write('\r\n\x1b[90m[process exited — close this tab with ×]\x1b[0m\r\n');
  t.exited = true; renderTabs();
});

// × on a tab: a running in-app session only leaves the tab row — it keeps running, and clicking it in Sessions or the
// mesh brings the tab back; quitting is /exit in its menu (2026-11-01). `really`: stop it (resume / move elsewhere).
const visibleTerms = () => [...terms].filter(([, t]) => !t.tabHidden).map(([id]) => id);
function closeTerm(id, really) {
  const t = terms.get(id); if (!t) return;
  if (!really && !t.peer && !t.exited) {
    t.tabHidden = true; t.el.classList.add('tab-hidden'); t.el.classList.remove('on');
    if (activeTerm === id) activeTerm = visibleTerms().pop() || null;
    if (activeTerm) activate(activeTerm); else renderTabs();
    $('#noTerms').style.display = visibleTerms().length ? 'none' : '';
    layoutGrid(); toast(`${t.title} keeps running. Click it in Sessions to bring its tab back; /exit in its menu quits it.`);
    return;
  }
  if (t.peer) { peerClosed.add(id); window.api.peerTerm.close(id); }   // a mirror: detach only, the session keeps running on the peer
  else if (!t.exited) window.api.pty.kill(id);
  t.stamps && t.stamps.dispose(); t.term.dispose(); t.el.remove(); terms.delete(id);
  if (activeTerm === id) activeTerm = [...terms.keys()].pop() || null;
  $('#noTerms').style.display = visibleTerms().length ? 'none' : '';
  if (activeTerm) activate(activeTerm); else renderTabs();
  if (isMini() && !terms.size) miniShow('mesh'); else renderRail();
  layoutGrid();
}

function activate(id) {
  // leaving a tab: remember whether you were reading its newest output. Only now, while it is still on screen, is that
  // reliable: a hidden terminal has no size, so xterm loses track of following the output while it is hidden and came
  // back mid-scroll (2026-11-11, a Hermes session showed an old part of its run instead of the end)
  { const prev = terms.get(activeTerm); if (prev && activeTerm !== id && prev.el.classList.contains('on') && prev.el.offsetHeight) { const b = prev.term.buffer.active; prev.pinned = b.viewportY >= b.baseY; } }
  { const t = terms.get(id); if (t && t.tabHidden) { t.tabHidden = false; t.el.classList.remove('tab-hidden'); $('#noTerms').style.display = 'none'; layoutGrid(); } }
  activeTerm = id;
  { const s = snap.sessions.find(x => termOf(x) === id); if (s) seen(s.sid); }
  for (const [k, t] of terms) t.el.classList.toggle('on', k === id);
  renderTabs(); markFocus();
  const tab = document.querySelector(`#tabs .tab[data-id="${id}"]`);   // bring the tab into view in a long tab row
  if (tab) tab.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: isSimple() ? 'auto' : 'smooth' });
  // repaint the one now shown: output written while its tab was hidden (a mirror's first screen arrives that way) is in
  // the buffer but was never drawn, and nothing redraws it until the grid or the font changes (2026-11-10: a MacBook
  // session opened on the mini stayed blank until you went to another tab and back)
  requestAnimationFrame(() => { fitAll(); const t = terms.get(id); if (t) { try { if (t.pinned !== false) t.term.scrollToBottom(); t.term.refresh(0, t.term.rows - 1); } catch { } t.term.focus(); } });   // back at the end unless you had scrolled up
  // a mirror shown before its first screen came (just attached, or the link dropped): ask for it now, not on the next tick
  { const t = terms.get(id); if (t && t.peer && !t.inited) setTimeout(() => { if (terms.get(id) === t && !t.inited) { t.attached = true; window.api.peerTerm.open(id); } }, 1200); }
}
function markFocus() { for (const [k, t] of terms) t.el.classList.toggle('focus', k === activeTerm); }

function renderTabs() {
  if (tabDrag) { tabDrag.dirty = true; return; }   // never rebuild the row under a tab being dragged
  applyTabOrder();
  $('#tabs').innerHTML = [...terms].filter(([, t]) => !t.tabHidden).map(([id, t]) => `<div class="tab ${id === activeTerm ? 'on' : ''}" data-id="${id}">
    <span class="hdot h-${t.health || (t.exited ? 'error' : 'idle')}"></span><span class="t">${esc(t.title)}</span>${t.local ? '<span class="tag">tmux</span>' : t.peer && snap.peer ? `<span class="tag peer">${esc(snap.peer.label)}</span>` : ''}<span class="x" data-x="${id}">×</span></div>`).join('') +
    `<div class="tab" id="tabNew" title="New session (⌘T)">＋</div>`;
  for (const el of document.querySelectorAll('.tab[data-id]')) { el.onclick = e => { if (tabDrag || el._dragged) { el._dragged = false; return; } if (e.target.dataset.x) closeTerm(e.target.dataset.x); else activate(el.dataset.id); };
    el.addEventListener('pointerdown', e => tabDragStart(e, el)); }
  $('#tabNew').onclick = openNew;
  for (const [, t] of terms) { t.el.querySelector('.ttl').textContent = t.title; t.el.querySelector('.hdot').className = 'hdot h-' + (t.health || 'idle'); }
}

// ---- reorder the terminal tabs by click-hold-dragging (2026-11-01); the order is kept per session ----
let tabDrag = null;
const tabKey = id => { const s = snap.sessions.find(x => termOf(x) === id); return s ? 's:' + s.sid : 't:' + id; };   // sessions keep their place across restarts
function applyTabOrder() {
  const order = store.get('tabOrder', []); if (!order.length || terms.size < 2) return;
  const rank = id => { const i = order.indexOf(tabKey(id)); return i < 0 ? 1e6 : i; };
  const ids = [...terms.keys()], sorted = ids.map((id, i) => [id, rank(id), i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(x => x[0]);
  if (sorted.every((id, i) => id === ids[i])) return;
  const m = new Map(sorted.map(id => [id, terms.get(id)])); terms.clear(); for (const [k, v] of m) terms.set(k, v);
}
function tabDragStart(e, el) {
  if (e.button !== 0 || e.target.dataset.x) return;
  const x0 = e.clientX, id = el.dataset.id; let on = false, slot = null;
  const tabsEl = $('#tabs'), others = () => [...tabsEl.querySelectorAll('.tab[data-id]')].filter(t => t !== el);
  const mv = ev => {
    if (!on) { if (Math.abs(ev.clientX - x0) < 6) return; on = true; tabDrag = { id }; el.classList.add('dragging'); document.body.classList.add('tab-dragging'); }
    el.style.transform = `translateX(${ev.clientX - x0}px)`;
    const list = others(); slot = list.length;
    for (let i = 0; i < list.length; i++) { const r = list[i].getBoundingClientRect(); if (ev.clientX < r.left + r.width / 2) { slot = i; break; } }
    list.forEach((t, i) => t.classList.toggle('drop-before', i === slot)); tabsEl.classList.toggle('drop-end', slot === list.length);
    const r = tabsEl.getBoundingClientRect(); if (ev.clientX > r.right - 30) tabsEl.scrollLeft += 12; else if (ev.clientX < r.left + 30) tabsEl.scrollLeft -= 12;
  };
  const up = () => {
    removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
    if (!on) return;
    el._dragged = true; el.style.transform = ''; el.classList.remove('dragging'); document.body.classList.remove('tab-dragging'); tabsEl.classList.remove('drop-end');
    const list = others().map(t => t.dataset.id); list.splice(slot == null ? list.length : slot, 0, id);
    const hiddenIds = [...terms.keys()].filter(k => !list.includes(k));
    const m = new Map([...list, ...hiddenIds].map(k => [k, terms.get(k)])); terms.clear(); for (const [k, v] of m) terms.set(k, v);
    store.set('tabOrder', [...terms.keys()].map(tabKey));
    tabDrag = null; renderTabs(); layoutGrid(); renderRail && renderRail();
  };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}

function syncTermTitles() {
  let changed = false;
  for (const [id, t] of terms) {
    const s = snap.sessions.find(x => termOf(x) === id);
    const title = s ? s.name : t.kind === 'claude' ? t.title : t.title;
    const health = s ? s.health : t.exited ? 'error' : 'idle';
    if (title !== t.title || health !== t.health) { t.title = title; t.health = health; changed = true; }
  }
  if (changed) renderTabs();
}

function fitAll() {
  for (const [id, t] of terms) {
    if (document.body.dataset.view !== 'grid' && !t.el.classList.contains('on')) continue;
    try { fitTerm(id, t); } catch { }
  }
}
function layoutGrid() {
  const n = Math.max(1, visibleTerms().length);
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  $('#terms').style.setProperty('--cols', cols);
  requestAnimationFrame(fitAll);
}
new ResizeObserver(() => fitAll()).observe($('#terms'));

// ---------------- views, dock resize, keys ----------------
function setView(v) {
  document.body.dataset.view = v; store.set('view', v);
  document.querySelectorAll('#viewSeg button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  layoutGrid(); requestAnimationFrame(() => { viz.resize(); fitAll(); });
}
document.querySelectorAll('#viewSeg button').forEach(b => b.onclick = () => setView(b.dataset.view));
setView(store.get('view', 'split'));

(() => {
  const dock = $('#dock'), h = $('#dockHandle');
  const saved = store.get('dockH', null); if (saved) dock.style.height = saved + 'px';
  h.onmousedown = e => {
    const y0 = e.clientY, h0 = dock.offsetHeight;
    const mm = ev => { const nh = Math.max(80, Math.min(window.innerHeight - 200, h0 - (ev.clientY - y0))); dock.style.height = nh + 'px'; viz.resize(); fitAll(); };
    const mu = () => { removeEventListener('mousemove', mm); removeEventListener('mouseup', mu); store.set('dockH', dock.offsetHeight); };
    addEventListener('mousemove', mm); addEventListener('mouseup', mu);
  };
})();

$('#newBtn').onclick = openNew;
$('#usagePill').onclick = openUsage;
// Simple mode: no canvas animation, glow or motion. The mesh becomes a static session board, so a
// Screen Sharing / VNC client (e.g. from the iPhone) only receives pixels that actually changed.
function isSimple() { return document.body.classList.contains('simple'); }
function setSimple(on) {
  document.body.classList.toggle('simple', on); store.set('simple', on);
  $('#simpleBtn').classList.toggle('on', on);
  $('#simpleBtn').textContent = on ? 'Mesh' : 'Simple';   // in Simple mode the button takes you back to the Mesh
  $('#simpleBtn').title = on ? 'Back to the animated Mesh (⌘P)' : 'Simple mode — no animation or motion, best over Screen Sharing / VNC (⌘P)';
  viz.paused = on;
  for (const [, t] of terms) t.term.options.cursorBlink = !on;
  lastBoard = ''; renderBoard();
  requestAnimationFrame(() => { viz.resize(); fitAll(); });
}
$('#simpleBtn').onclick = () => { lockSimple = false; setSimple(!isSimple()); toast(isSimple() ? 'Simple mode on: no animation' : 'Simple mode off'); };
setSimple(store.get('simple', false));
$('#bell').classList.toggle('on', bell);
$('#bell').onclick = () => { bell = !bell; store.set('bell', bell); $('#bell').classList.toggle('on', bell); toast(bell ? 'Notifications on' : 'Notifications off'); };
addEventListener('keydown', e => {
  if (!e.metaKey) { if (e.key === 'Escape' && !$('#modal').classList.contains('hidden')) closeModal(); return; }
  if (e.key === '1') { e.preventDefault(); setView('mesh'); }
  else if (e.key === '2') { e.preventDefault(); setView('split'); }
  else if (e.key === '3') { e.preventDefault(); setView('grid'); }
  else if (e.key === 't') { e.preventDefault(); openNew(); }
  else if (e.key === 'b') { e.preventDefault(); openBroadcast(); }
  else if (e.key === 'p') { e.preventDefault(); $('#simpleBtn').click(); }
  else if (/^[4-9]$/.test(e.key)) { const id = [...terms.keys()][+e.key - 4]; if (id) { e.preventDefault(); activate(id); } }
});

// ---------------- notifications ----------------
function notifyTransitions() {
  const live = new Set(snap.sessions.map(s => s.sid));
  for (const sid of doneSids) if (!live.has(sid)) { doneSids.delete(sid); saveDone(); }
  for (const s of snap.sessions) {
    const p = prevHealth.get(s.sid);
    if (p && p !== s.health) {
      const busy = h => h === 'working' || h === 'quiet';
      const watching = document.hasFocus() && (s.sid === selected || (s.owner && s.owner === activeTerm && document.body.dataset.view !== 'mesh'));
      if (busy(p) && (s.health === 'idle' || s.health === 'waiting' || s.health === 'error') && !watching) { doneSids.add(s.sid); saveDone(); renderList(); }
      else if (busy(s.health) && doneSids.has(s.sid)) seen(s.sid);   // picked up again elsewhere
    }
    if (p && p !== s.health && bell) {
      if (p === 'working' && s.health === 'idle') window.api.notify(`✓ ${s.name}`, `Finished · ${fmtTok(s.todayTok)} tokens today`);
      if (s.health === 'error') window.api.notify(`⚠ ${s.name}`, s.lastError || 'API error');
      if (s.health === 'waiting') window.api.notify(`… ${s.name}`, 'Needs your input');
    }
    prevHealth.set(s.sid, s.health);
  }
}

// ---------------- resizable sidebar (drag its right edge; double-click to reset) ----------------
{
  const side = $('#side'), h = $('#sideHandle'), MIN = 200, MAX = 560, DEF = 250;
  const apply = w => { side.style.width = Math.max(MIN, Math.min(MAX, w)) + 'px'; };
  apply(store.get('sideW', DEF));
  h.addEventListener('mousedown', e => {
    e.preventDefault(); const x0 = e.clientX, w0 = side.getBoundingClientRect().width;
    document.body.classList.add('side-resizing');
    const mv = ev => { apply(w0 + ev.clientX - x0); viz.resize(); fitAll && fitAll(); };
    const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); document.body.classList.remove('side-resizing');
      store.set('sideW', side.getBoundingClientRect().width); viz.resize(); };
    addEventListener('mousemove', mv); addEventListener('mouseup', up);
  });
  h.addEventListener('dblclick', () => { apply(DEF); store.set('sideW', DEF); viz.resize(); });
}

// ---------------- window size modes: full → compact → mini ----------------
// compact (narrow/short window): the sidebar becomes a slide-over drawer (☰ / ⌘0), the detail panel floats,
//   header drops the model chips and health pills.
// mini (small widget-sized window): a slim bar with plan usage left, the mesh with a smaller star, and a
//   session strip along the bottom — tap a session to fill the window with its terminal, ◎ to go back.
const isMini = () => document.body.dataset.size === 'mini';
let miniPane = store.get('miniPane', 'mesh');
function sizeMode() {
  const w = innerWidth, h = innerHeight;
  const m = w < 700 || h < 470 ? 'mini' : w < 1180 || h < 700 ? 'compact' : 'full';
  if (document.body.dataset.size !== m) {
    document.body.dataset.size = m;
    viz.compact = m === 'mini';
    document.body.classList.remove('drawer');
    if (m === 'mini') { if (miniPane === 'term' && !terms.size) miniPane = 'mesh'; document.body.dataset.mini = miniPane; }
    renderRail();
  }
  requestAnimationFrame(() => { viz.resize(); fitAll(); });
}
function miniShow(p) {
  miniPane = p === 'term' && terms.size ? 'term' : 'mesh'; store.set('miniPane', miniPane);
  document.body.dataset.mini = miniPane; renderRail();
  requestAnimationFrame(() => { viz.resize(); fitAll(); const t = terms.get(activeTerm); if (miniPane === 'term' && t) t.term.focus(); });
}
function renderRail() {
  const u = (snap.usage && snap.usage.limits) || [];
  $('#miniUsage').innerHTML = u.slice(0, 3).map(l => { const left = Math.max(0, 100 - l.used), col = limitColor(left, l);
    return `<span class="mu" title="${esc(l.label)} · resets in ${fmtReset(l.resetsAt)}"><b style="color:${col}">${Math.round(left)}%</b> ${esc(l.label === 'All models' ? 'week' : l.label === 'Session' ? '5h' : String(l.label || l.kind || '').split(' ')[0].toLowerCase())}<i><em style="width:${left}%;background:${col}"></em></i></span>`; }).join('')
    + `<span class="mu">${snap.ready ? fmtTok(snap.todayTok) : '…'}</span>`;
  if (!isMini()) return;
  const S = [...snap.sessions].sort((a, b) => (b.owner ? 1 : 0) - (a.owner ? 1 : 0) || (b.health === 'working') - (a.health === 'working'));
  const onTerm = miniPane === 'term';
  const curSid = onTerm ? (snap.sessions.find(x => x.owner === activeTerm) || {}).sid : selected;
  const chips = S.map(s => `<button class="rchip ${s.sid === curSid ? 'on' : ''} ${s.owner ? 'app' : ''}" data-sid="${s.sid}" title="${esc(s.name)} · ${esc(s.health)} · ${fmtTok(s.todayTok)} tokens today${s.owner ? '' : ' · not in this app — opens its controls'}">
      <span class="hdot h-${s.health}"></span><span class="t">${esc(s.name)}</span>${s.health === 'working' ? `<span class="r">${Math.round(s.tps)}</span>` : ''}</button>`).join('');
  const shells = [...terms].filter(([id]) => !snap.sessions.some(s => s.owner === id))
    .map(([id, t]) => `<button class="rchip app ${onTerm && id === activeTerm ? 'on' : ''}" data-pty="${id}"><span class="hdot h-${t.exited ? 'error' : 'idle'}"></span><span class="t">${esc(t.title)}</span></button>`).join('');
  $('#rail').innerHTML = `<button class="rchip home ${onTerm ? '' : 'on'}" id="railMesh" title="Mesh">◎</button>${shells}${chips}<button class="rchip add" id="railNew" title="New session (⌘T)">＋</button>`;
  const on = $('#rail .rchip.on:not(.home)'); if (on && curSid !== renderRail.last) { renderRail.last = curSid; on.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }
  $('#railMesh').onclick = () => miniShow('mesh');
  $('#railNew').onclick = openNew;
  document.querySelectorAll('#rail [data-sid]').forEach(b => b.onclick = () => { const s = snap.sessions.find(x => x.sid === b.dataset.sid); if (s && s.owner && terms.has(s.owner)) select(s.sid); else { miniShow('mesh'); select(b.dataset.sid); } });
  document.querySelectorAll('#rail [data-pty]').forEach(b => b.onclick = () => { miniShow('term'); activate(b.dataset.pty); });
}
$('#drawerBtn').onclick = () => document.body.classList.toggle('drawer');
$('#mesh').addEventListener('pointerdown', () => document.body.classList.remove('drawer'));
addEventListener('keydown', e => { if (e.metaKey && e.key === '0') { e.preventDefault(); $('#drawerBtn').click(); } else if (e.key === 'Escape') document.body.classList.remove('drawer'); });
addEventListener('resize', sizeMode);
sizeMode();

// coming back to the window with a finished session's terminal already in front counts as looking at it
addEventListener('focus', () => { if (document.body.dataset.view === 'mesh') return; const s = snap.sessions.find(x => x.owner && x.owner === activeTerm); if (s) seen(s.sid); });

// ---------------- seamless updates (updater.js) ----------------
// What goes through a reload or a restart: the view, the selected session, the active tab, scroll, an unsent prompt, and this
// window's own terminals. Panel layout and window position already keep themselves.
window.api.update.onSave(why => {
  const scroll = {}; for (const id of ['list', 'side', 'panelBody', 'histList']) { const e = document.getElementById(id); if (e) scroll[id] = e.scrollTop; }
  const c = $('#cText'), state = { view: document.body.dataset.view, selected, activeTerm, activeSid: sidForTerm(activeTerm), scroll, draft: c ? c.value : '' };
  const own = why !== 'hot' ? [] : [...terms].filter(([, t]) => !t.peer && t.ser && !t.exited).map(([id, t]) => { flushTerm(t); let saved = ''; try { saved = t.ser.serialize({ scrollback: 1500 }); } catch { } return { id, title: t.title, kind: t.kind, saved }; });
  window.api.update.saved(state, own);
});
function updateNote(n) {
  const el = document.createElement('div'); el.className = 'upd-note';
  el.innerHTML = `<span>Updated to ${esc(n.to)}${n.subject ? `: ${esc(n.subject.slice(0, 70))}` : ''}</span>${n.canRollback ? '<button id="updBack">Roll back</button>' : ''}<button id="updX">Dismiss</button>`;
  el.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:9999;display:flex;gap:10px;align-items:center;padding:8px 12px;border-radius:10px;background:#111;border:1px solid #333;color:#ddd;font-size:12px';
  document.body.appendChild(el);
  $('#updX').onclick = () => el.remove();
  const b = $('#updBack'); if (b) b.onclick = () => { b.disabled = true; b.textContent = 'Rolling back…'; window.api.update.rollback(); };
  setTimeout(() => el.remove(), 20000);
}
(async () => {
  const h = await window.api.update.handoff().catch(() => null); window.api.update.ready();
  if (!h) return;
  for (const t of h.terms || []) await newTerm({ kind: t.kind, adopt: { id: t.id, title: t.title }, saved: t.saved });
  if (h.note) updateNote(h.note);
  const st = h.state; if (!st) return;
  for (let i = 0; i < 120 && !snap.ready; i++) await new Promise(r => setTimeout(r, 250));
  await new Promise(r => setTimeout(r, 1500));
  if (st.view) setView(st.view);
  if (st.selected) select(st.selected);
  const live = (snap.sessions || []).find(s => s.sid === st.activeSid), tab = live ? termOf(live) : st.activeTerm;
  if (tab && terms.has(tab)) activate(tab);
  requestAnimationFrame(() => { for (const [id, top] of Object.entries(st.scroll || {})) { const e = document.getElementById(id); if (e) e.scrollTop = top; } const c = $('#cText'); if (c && st.draft) c.value = st.draft; });
})();
