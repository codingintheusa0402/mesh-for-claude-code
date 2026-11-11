// All sessions (the same set `claude --resume` lists), background agents, rename and
// convert-to-agent. Clicking a past session resumes it in an in-app terminal straight away,
// with --dangerously-skip-permissions (never stops to ask) and --remote-control (reachable from phone/web).
const RESUME_FLAGS = '--dangerously-skip-permissions --remote-control';
let hist = [], histShown = 60, histLoaded = false, histErr = null;
const projName = cwd => !cwd ? '?' : cwd === HOME_DIR ? '~' : cwd.split('/').filter(Boolean).pop();
let HOME_DIR = ''; window.api.home().then(h => { HOME_DIR = h; });
const histTitle = h => h.title || h.aiTitle || h.first || h.last || h.sid.slice(0, 8);
const agoT = t => ago((Date.now() - t) / 1000);

async function loadHistory() {
  try { hist = await window.api.history(); histErr = null; } catch (e) { histErr = e.message || 'failed'; }
  histLoaded = true; renderHistory(); pruneReplaced();
}
// a name handed off twice: keep the current session and the one before it ("replaced"); older copies go to the Trash
// (Kevin 2026-11-10). This machine's Claude transcripts only, never pinned or running ones; the other Mac prunes its own.
const pruneTried = new Set();
async function pruneReplaced() {
  if (!histLoaded || histErr || !window.api.historyTrash) return;
  const liveSids = new Set(snap.sessions.map(s => s.sid)), pins = new Set(histPins), groups = new Map();
  const key = n => (n || '').replace(/\s*·\s*before refresh.*$/i, '').trim().toLowerCase();
  for (const s of snap.sessions) { const k = key(s.name); if (k) (groups.get(k) || groups.set(k, []).get(k)).push({ sid: s.sid, t: Infinity, live: true }); }
  for (const h of hist) { const k = key(h.title); if (!k || liveSids.has(h.sid)) continue; (groups.get(k) || groups.set(k, []).get(k)).push({ sid: h.sid, t: h.mtime, h }); }
  const gone = [];
  for (const g of groups.values()) {
    g.sort((a, b) => b.t - a.t);
    for (const x of g.slice(2)) {
      if (x.live || !x.h || x.h.onPeer || x.h.kind === 'hermes' || pins.has(x.sid) || pruneTried.has(x.sid)) continue;
      pruneTried.add(x.sid);
      const r = await window.api.historyTrash(x.sid); if (r && r.ok) gone.push(x.sid);
    }
  }
  if (gone.length) { hist = hist.filter(h => !gone.includes(h.sid)); renderHistory(); toast(`Moved ${gone.length} old handed-off session${gone.length > 1 ? 's' : ''} to the Trash`); }
}
// groups: Running (live) on top, then 📌 Pinned, then everything else by recency.
// Within each group you can press-and-drag rows to set your own order (saved per group).
let histPins = store.get('hist.pins', []), histOrder = store.get('hist.order', {}), histDragging = false;
let histHidden = new Set(store.get('hist.hidden', []));      // removed from the list (still found by search)
const savePins = () => store.set('hist.pins', histPins), saveOrder = () => store.set('hist.order', histOrder);
const saveHidden = () => store.set('hist.hidden', [...histHidden]);
function orderGroup(key, list) {
  const ord = histOrder[key] || [], pos = new Map(ord.map((sid, i) => [sid, i]));
  return list.sort((a, b) => (pos.has(a.sid) ? pos.get(a.sid) : 1e6) - (pos.has(b.sid) ? pos.get(b.sid) : 1e6) || b.mtime - a.mtime);
}
function renderHistory() {
  if (histDragging) return;                                   // don't redraw under a drag
  const q = $('#hSearch').value.trim().toLowerCase(), auto = $('#hAuto').checked;
  const liveSids = new Set(snap.sessions.map(s => s.sid)), agentSids = new Set((snap.agents || []).map(a => a.sessionId));
  const rows = hist.filter(h => (auto || h.entry !== 'sdk-cli') && (q || liveSids.has(h.sid) || !histHidden.has(h.sid)) &&
    (!q || [h.title, h.aiTitle, h.first, h.last, h.cwd, h.branch, h.sid].some(v => v && v.toLowerCase().includes(q))));
  $('#hCount').textContent = !histLoaded ? '· reading…' : histErr ? "· couldn't update" : '· ' + rows.length;
  const pins = new Set(histPins);
  const groups = [
    ['live', 'Running', orderGroup('live', rows.filter(h => liveSids.has(h.sid)))],
    ['pinned', '📌 Pinned', orderGroup('pinned', rows.filter(h => !liveSids.has(h.sid) && pins.has(h.sid)))],
    ['rest', 'Recent', orderGroup('rest', rows.filter(h => !liveSids.has(h.sid) && !pins.has(h.sid)))],
  ];
  // replaced: an older session with the same name as a newer one (a handoff / session refresh starts the new one under
  // the old name; Hermes renames the old one "… · before refresh …"). Only named sessions, never a running one.
  const baseName = h => (h.title || '').replace(/\s*·\s*before refresh.*$/i, '').trim().toLowerCase();
  const newest = new Map();
  for (const s of snap.sessions) { const k = baseName({ title: s.name }); if (k) newest.set(k, { t: Infinity, sid: s.sid }); }   // running sessions by their Mesh name
  for (const h of hist) { const k = baseName(h); if (!k) continue; const t = liveSids.has(h.sid) ? Infinity : h.mtime; if (!newest.has(k) || t > newest.get(k).t) newest.set(k, { t, sid: h.sid }); }
  const replacedBy = h => { const k = baseName(h), n = k && newest.get(k); return n && n.sid !== h.sid && !liveSids.has(h.sid) ? n : null; };
  let shown = 0;
  const rowHtml = (h, g) => {
    const live = liveSids.has(h.sid), ag = agentSids.has(h.sid), pinned = pins.has(h.sid), old = replacedBy(h);
    return `<div class="hrow ${live ? 'live' : ''} ${pinned ? 'pinned' : ''} ${old ? 'replaced' : ''}${live ? doneCls(h.sid) : ''}" draggable="true" data-group="${g}" data-hsid="${h.sid}" title="${esc(histTitle(h))}\n${esc(h.cwd)}${h.last ? '\nlast: ' + esc(h.last) : ''}\n(drag to reorder)">
      <div class="n"><span class="t">${esc(histTitle(h))}</span>${h.onPeer ? `<span class="tag peer">${esc(h.hostLabel)}</span>` : ''}${live ? '<span class="tag">live</span>' : ag ? '<span class="tag">agent</span>' : old ? `<span class="tag old" title="Replaced: a newer session with this name took over (handoff or refresh)${old.t === Infinity ? ' and is running now' : ''}. This one is kept for history.">replaced</span>` : ''}<span class="pin ${pinned ? 'on' : ''}" data-pin="${h.sid}" title="${pinned ? 'Unpin' : 'Pin'}">📌</span><span class="more" data-hmore="${h.sid}">⋯</span><span class="rm" data-hrm="${h.sid}" title="${live ? 'Stop and remove from Running' : 'Remove from list'}">×</span></div>
      <div class="m">${esc(projName(h.cwd))}${h.branch && h.branch !== 'HEAD' ? ' · ' + esc(h.branch) : ''} · ${agoT(h.mtime)} · ${h.kind === 'hermes' ? 'Hermes · ' + (h.msgs || 0) + ' msgs' : h.size > 1e6 ? (h.size / 1e6).toFixed(1) + 'MB' : Math.round(h.size / 1e3) + 'kB'}</div></div>`;
  };
  let html = '';
  for (const [g, label, list] of groups) {
    if (!list.length) continue;
    const vis = g === 'rest' ? list.slice(0, Math.max(0, histShown - shown)) : list; shown += vis.length;
    html += `<div class="hgroup" data-group="${g}"><div class="hgh">${label} <i>${list.length}</i></div>${vis.map(h => rowHtml(h, g)).join('')}</div>`;
  }
  const restLen = groups[2][2].length, restShown = Math.max(0, histShown - groups[0][2].length - groups[1][2].length);
  $('#hList').innerHTML = html + (restLen > restShown ? `<div class="hmore" id="hMore">Show ${Math.min(100, restLen - restShown)} more…</div>` : '');
  const m = $('#hMore'); if (m) m.onclick = () => { histShown += 100; renderHistory(); };
}
function togglePin(sid) {
  histPins = histPins.includes(sid) ? histPins.filter(x => x !== sid) : [sid, ...histPins]; savePins(); renderHistory();
  toast(histPins.includes(sid) ? 'Pinned' : 'Unpinned');
}
// drag-to-reorder (within the row's own group)
{
  const L = $('#hList'); let dragSid = null, dragGroup = null;
  L.addEventListener('dragstart', e => { const r = e.target.closest('.hrow'); if (!r) return; dragSid = r.dataset.hsid; dragGroup = r.dataset.group; histDragging = true;
    r.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragSid); });
  L.addEventListener('dragover', e => {
    const over = e.target.closest('.hrow'); if (!dragSid || !over || over.dataset.group !== dragGroup) return;
    e.preventDefault(); const dragged = L.querySelector(`.hrow[data-hsid="${dragSid}"]`); if (!dragged || over === dragged) return;
    const r = over.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    over.parentNode.insertBefore(dragged, after ? over.nextSibling : over);
  });
  const end = () => {
    if (!dragSid) return;
    const grp = L.querySelector(`.hgroup[data-group="${dragGroup}"]`);
    if (grp) { histOrder[dragGroup] = [...grp.querySelectorAll('.hrow')].map(r => r.dataset.hsid); saveOrder(); }
    L.querySelectorAll('.dragging').forEach(r => r.classList.remove('dragging'));
    dragSid = dragGroup = null; histDragging = false; renderHistory();
  };
  L.addEventListener('drop', e => { e.preventDefault(); end(); });
  L.addEventListener('dragend', end);
}
$('#hSearch').oninput = () => { histShown = 60; renderHistory(); };
$('#hAuto').onchange = () => { store.set('hAuto', $('#hAuto').checked); renderHistory(); };
$('#hAuto').checked = store.get('hAuto', false);

// resume: live → select it; agent → attach; otherwise open a terminal running --resume
async function resumeSession(sid, opts) {
  const live = snap.sessions.find(s => s.sid === sid);
  if (live) { select(sid); if (bringTerm(live)) { if (document.body.dataset.view === 'mesh') setView('split'); activate(termOf(live)); } return; }
  const ag = (snap.agents || []).find(a => a.sessionId === sid);
  if (ag) return attachAgent(ag);
  const h = hist.find(x => x.sid === sid); if (!h) return;
  if (h.onPeer) {                       // its transcript is only on the other machine: resume it there (its terminal shows up here)
    const r = await window.api.peer.resume(sid);
    return toast(r && r.ok ? `Resuming on ${h.hostLabel}: ${histTitle(h).slice(0, 40)}` : `Couldn't resume on ${h.hostLabel}${r && r.err ? ': ' + r.err : ''}`);
  }
  const id = await newTerm({ kind: 'claude', cwd: h.cwd, flags: `${RESUME_FLAGS} --resume ${sid}`, title: histTitle(h).slice(0, 40), ...(opts || {}) });
  autoTrust.set(id, { until: Date.now() + 20000, buf: '' });
  toast('Resuming ' + histTitle(h).slice(0, 50));
}
// You already worked in this folder (that's where the session came from), so the one-time
// "Do you trust this folder?" screen is answered for you: ↓ to "Yes, I trust this folder", Enter.
const autoTrust = new Map();
window.api.pty.onData((id, d) => {
  const a = autoTrust.get(id); if (!a) return;
  if (Date.now() > a.until) return autoTrust.delete(id);
  a.buf = (a.buf + d).slice(-4000);
  if (/Yes,Itrustthisfolder/.test(a.buf.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\s/g, ''))) {   // Ink draws spaces as cursor moves
    autoTrust.delete(id);
    setTimeout(() => { window.api.pty.write(id, '\x1b[B'); setTimeout(() => window.api.pty.write(id, '\r'), 700); }, 700);
  }
});
function attachAgent(a) {
  return newTerm({ kind: 'claude', cwd: a.cwd, flags: `attach ${a.id}`, title: '⚙ ' + (agentName(a)) });
}

$('#hList').addEventListener('click', e => {
  const pn = e.target.closest('[data-pin]'); if (pn) { e.stopPropagation(); return togglePin(pn.dataset.pin); }
  const rm = e.target.closest('[data-hrm]'); if (rm) { e.stopPropagation(); return removeSession(rm.dataset.hrm); }
  const m = e.target.closest('[data-hmore]');
  if (m) { e.stopPropagation(); const r = m.getBoundingClientRect(); return openSessMenu(m.dataset.hmore, r.right + 6, r.top); }
  const row = e.target.closest('.hrow'); if (row) resumeSession(row.dataset.hsid);
});
$('#hList').addEventListener('contextmenu', e => { const row = e.target.closest('.hrow'); if (row) { e.preventDefault(); openSessMenu(row.dataset.hsid, e.clientX, e.clientY); } });

// ---------------- small action menu for history / agent rows ----------------
function openSessMenu(sid, x, y, agent) {
  closeCmdMenu();
  const h = hist.find(q => q.sid === sid), live = snap.sessions.find(s => s.sid === sid);
  const ag = agent || (snap.agents || []).find(a => a.sessionId === sid);
  const items = ag ? [
    ['Attach (open in terminal)', () => attachAgent(ag)],
    ['Show logs', () => showAgentLogs(ag)],
    ['Rename…', () => renameSession(ag.sessionId, ag.name)],
    ['Stop agent', () => stopAgent(ag), true],
  ] : h && h.onPeer && !live ? [            // only on the other machine: it is resumed (and renamed …) over there
    [`Resume on ${h.hostLabel}`, () => resumeSession(sid)],
    histHidden.has(sid) ? ['Show in list again', () => { histHidden.delete(sid); saveHidden(); renderHistory(); }]
      : ['Remove from list', () => { histHidden.add(sid); saveHidden(); renderHistory(); toast('Removed from list'); }, true],
  ] : [
    [live ? 'Go to live session' : 'Resume here', () => resumeSession(sid)],
    ['Rename…', () => renameSession(sid, h ? histTitle(h) : live && live.name)],
    ['Convert to background agent…', () => convertToAgent(sid)],
    histHidden.has(sid) && !live ? ['Show in list again', () => { histHidden.delete(sid); saveHidden(); renderHistory(); }]
      : [live ? 'Stop and remove…' : 'Remove from list', () => removeSession(sid), true],
  ];
  const el = document.createElement('div'); el.id = 'cmdMenu';
  el.innerHTML = `<div class="cm-h">${esc(ag ? (ag.name || ag.id) : h ? histTitle(h) : live ? live.name : sid.slice(0, 8))}</div><div class="cm-list">` +
    items.map(([l, , d], i) => `<div class="cm-i ${d ? 'danger' : ''}" data-i="${i}"><b>${esc(l)}</b></div>`).join('') + '</div>';
  document.body.appendChild(el); cmdMenu = { el };
  const r = el.getBoundingClientRect();
  el.style.left = Math.min(x, innerWidth - r.width - 10) + 'px'; el.style.top = Math.min(y, innerHeight - r.height - 10) + 'px';
  el.querySelectorAll('.cm-i').forEach(n => n.onclick = () => { closeCmdMenu(); items[+n.dataset.i][1](); });
}

// ---------------- remove from the list ----------------
// Running → asks, stops it (closes its in-app terminal, or ends the claude process), and it drops to Recent.
// Not running → hidden from the list (search still finds it; ⋯ → Show in list again).
async function removeSession(sid) {
  const live = snap.sessions.find(s => s.sid === sid), h = hist.find(x => x.sid === sid);
  const name = live ? live.name : h ? histTitle(h) : sid.slice(0, 8);
  if (!live) {
    histHidden.add(sid); saveHidden(); renderHistory();
    return toast('Removed ' + name.slice(0, 50) + ' — search still finds it');
  }
  if (live.onPeer) return toast(`${name.slice(0, 50)} runs on ${live.hostLabel}. Stop it there.`);
  modal(`<h2>Stop this session?</h2>
    <div style="color:var(--dim);line-height:1.6;font-size:13px"><b style="color:var(--text)">${esc(name)}</b> is still running${live.health === 'working' ? ' <b style="color:var(--warn)">and working right now</b>' : ''}.
    Removing it stops it${live.owner ? ' and closes its terminal' : live.tty ? ' (its Terminal.app tab stays open)' : ''}. It moves to <b style="color:var(--text)">Recent</b>, where you can resume it any time.</div>
    <div class="btns" style="justify-content:flex-end"><button id="mCancel">Cancel</button><button class="danger" id="rmGo">Stop and remove</button></div>`);
  $('#rmGo').onclick = async () => {
    closeModal(); histHidden.delete(sid); saveHidden();
    if (live.owner && terms.has(live.owner)) closeTerm(live.owner, true);
    else { const r = await window.api.stopSession(live.pid); if (!r.ok) return toast('Could not stop it: ' + (r.err || '')); }
    toast('Stopped ' + name.slice(0, 50) + ' — now under Recent');
    lastHistKey = ''; setTimeout(loadHistory, 1500);
  };
}

// ---------------- rename ----------------
function renameSession(sid, current) {
  modal(`<h2>Rename session</h2><label>Name</label><input type="text" id="rnName" value="${esc(current || '')}">
    <div class="note" style="color:var(--dim);font-size:12px;margin-top:8px">Shows in the /resume picker and here.</div>
    <div class="btns" style="justify-content:flex-end"><button id="mCancel">Cancel</button><button class="primary" id="rnGo">Rename</button></div>`);
  const inp = $('#rnName'); inp.focus(); inp.select();
  const go = async () => {
    const name = inp.value.trim().replace(/\s+/g, ' '); if (!name) return;
    closeModal();
    const live = snap.sessions.find(s => s.sid === sid);
    let r;
    if (live && canControl(live)) {          // a running session renames itself, so its prompt box/title update too
      r = await sessSend(live, (live.kind === 'hermes' ? '/title ' : '/rename ') + name);   // Hermes Agent names a session with /title
      if (r && (r.ok === false || r.out === 'notfound')) r = await window.api.rename(sid, name);
    } else r = await window.api.rename(sid, name);
    if (r && r.ok === false) return toast('Rename failed: ' + (r.err || ''));
    const h = hist.find(x => x.sid === sid); if (h) h.title = name;
    renderHistory(); toast('Renamed → ' + name);
  };
  $('#rnGo').onclick = go; inp.onkeydown = e => { if (e.key === 'Enter') go(); };
}

// ---------------- convert to background agent ----------------
function convertToAgent(sid) {
  const live = snap.sessions.find(s => s.sid === sid), h = hist.find(x => x.sid === sid);
  const name = live ? live.name : h ? histTitle(h) : sid.slice(0, 8), cwd = live ? live.cwd : h && h.cwd;
  const note = live && live.owner ? 'It is open in an in-app terminal — that terminal will be closed and the session continues in the background under the same id.'
    : live ? 'It is still running in Terminal.app, so Claude starts a background <b>copy</b> (the Terminal one keeps going). Exit it first to move it instead.'
    : 'The session continues in the background under the same id, with permissions skipped. It shows under <b>Agents</b>; attach any time.';
  modal(`<h2>Convert to agent</h2>
    <div style="color:var(--dim);line-height:1.6;font-size:13px"><b style="color:var(--text)">${esc(name)}</b><br>${note}</div>
    <label>Task for the agent (optional — leave empty to just park it in the background)</label>
    <textarea id="cvTask" placeholder="e.g. keep going with the remaining items and report when done"></textarea>
    <div class="btns" style="justify-content:flex-end"><button id="mCancel">Cancel</button><button class="primary" id="cvGo">Convert</button></div>`);
  $('#cvTask').focus();
  $('#cvGo').onclick = async () => {
    const task = $('#cvTask').value; closeModal();
    if (live && live.owner) { closeTerm(live.owner, true); await new Promise(r => setTimeout(r, 1500)); }
    toast('Starting agent…');
    const r = await window.api.agents.convert(sid, cwd, task);
    if (!r.ok) return modal(`<h2>Convert failed</h2><pre class="logs">${esc(r.err || r.out)}</pre><div class="btns" style="justify-content:flex-end"><button id="mCancel">Close</button></div>`);
    toast((r.out.split('\n').pop() || 'Agent started').slice(0, 120));
    snap.agents = await window.api.agents.list(); renderAgents();
  };
}

// ---------------- agents list ----------------
const agentName = a => a.name || (hist.find(h => h.sid === a.sessionId) && histTitle(hist.find(h => h.sid === a.sessionId))) || a.id;
function renderAgents() {
  const A = snap.agents || [];
  $('#agentsBox').style.display = A.length ? '' : 'none';
  $('#agCount').textContent = '· ' + A.length;
  $('#agList').innerHTML = A.map(a => `<div class="arow" data-aid="${a.id}" title="click to attach · ${esc(a.cwd)}">
    <div class="n"><span class="hdot ast-${esc(a.state || a.status || '')}"></span><span class="t">${esc(agentName(a))}</span><span class="more" data-amore="${a.id}">⋯</span></div>
    <div class="m">${esc(a.state || a.status || '')} · ${esc(projName(a.cwd))} · ${a.startedAt ? agoT(a.startedAt) : ''}</div></div>`).join('');
}
$('#agList').addEventListener('click', e => {
  const A = snap.agents || [], m = e.target.closest('[data-amore]');
  if (m) { e.stopPropagation(); const a = A.find(x => x.id === m.dataset.amore), r = m.getBoundingClientRect(); return openSessMenu(a.sessionId, r.right + 6, r.top, a); }
  const row = e.target.closest('.arow'); if (row) attachAgent(A.find(x => x.id === row.dataset.aid));
});
$('#agList').addEventListener('contextmenu', e => { const row = e.target.closest('.arow'); if (row) { e.preventDefault(); const a = (snap.agents || []).find(x => x.id === row.dataset.aid); openSessMenu(a.sessionId, e.clientX, e.clientY, a); } });
async function showAgentLogs(a) {
  modal(`<h2>${esc(agentName(a))} · logs</h2><pre class="logs">loading…</pre><div class="btns" style="justify-content:flex-end"><button id="mCancel">Close</button></div>`);
  const r = await window.api.agents.logs(a.id); const pre = document.querySelector('.card pre.logs'); if (pre) { pre.textContent = r.out || r.err || '(no output)'; pre.scrollTop = pre.scrollHeight; }
}
async function stopAgent(a) {
  if (!await confirmCmd({ name: agentName(a) }, { cmd: 'Stop agent', desc: 'Stop the background agent' })) return;
  const r = await window.api.agents.stop(a.id); toast(r.ok ? 'Stopped ' + (agentName(a)) : 'Stop failed');
  snap.agents = await window.api.agents.list(); renderAgents();
}

// keep in sync with telemetry; history rescans every 20s (cached per file, only changed ones re-read)
// re-render only when something visible changed (live set, agents), not on every 1 s tick
let lastHistKey = '', lastAgKey = '';
window.api.onTelemetry(() => {
  const ak = JSON.stringify(snap.agents || []); if (ak !== lastAgKey) { lastAgKey = ak; renderAgents(); }
  const hk = snap.sessions.map(s => s.sid).join() + '|' + [...doneSids].join() + '|' + doneFade.size + '|' + (snap.agents || []).map(a => a.sessionId).join() + '|' + hist.length + '|' + Math.floor(Date.now() / 60000);
  if (hist.length && hk !== lastHistKey && !$('#hList').matches(':hover')) { lastHistKey = hk; renderHistory(); }
});
loadHistory(); setInterval(loadHistory, 20000);

// ---------------- iPhone access (phone-server.js) ----------------
// The phone asks the Mac to resume a session → do exactly what a click in "All sessions" does.
window.api.phone.onResume(async (sid, opts) => { if (opts || !hist.length) await loadHistory(); resumeSession(sid, opts); });

async function openPhone() {
  const st = await window.api.phone.status();
  const qrs = await Promise.all(st.urls.map(u => window.api.phone.qr(u.url)));
  modal(`<h2>${APP_NAME} on iPhone</h2>
    <label class="chk" style="margin:4px 0 10px"><input type="checkbox" id="phOn" ${st.enabled ? 'checked' : ''}> Allow phone access <span style="color:var(--dim)">(off = nothing listens)</span></label>
    ${st.enabled ? (st.urls.length ? `<div class="ph-qrs">${st.urls.map((u, i) => `<div class="ph-qr"><img src="${qrs[i]}" alt=""><b>${esc(u.kind)}</b><code>${esc(u.url.replace(/\?t=.*/, ''))}</code><button data-copy="${esc(u.url)}">Copy link</button></div>`).join('')}</div>
      <div style="color:var(--dim);font-size:12px;line-height:1.6;margin-top:10px">1. Scan with the iPhone camera → it opens in Safari.<br>2. Share → <b style="color:var(--text)">Add to Home Screen</b> — or scan it inside the native ${APP_NAME} iPhone app.<br>
      Tailscale works from anywhere (phone needs Tailscale on). The QR holds a private pairing key — don't share it. ${st.clients ? `<br><b style="color:var(--ok)">${st.clients} phone(s) connected</b>` : ''}</div>` : '<div style="color:var(--dim)">No network address found — connect to Wi-Fi or Tailscale.</div>')
      : '<div style="color:var(--dim);font-size:13px">Turn on to show the pairing QR code.</div>'}
    <div class="btns" style="justify-content:space-between;margin-top:14px">${st.enabled ? '<button id="phRegen">New pairing key</button>' : '<span></span>'}<button id="mCancel">Close</button></div>`);
  document.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy); toast('Pairing link copied — paste it in the iPhone app (or AirDrop it)'); });
  $('#phOn').onchange = async e => { await window.api.phone.set(e.target.checked); openPhone(); };
  const rg = $('#phRegen'); if (rg) rg.onclick = async () => { await window.api.phone.regen(); toast('New key — paired phones must scan again'); openPhone(); };
}
$('#phoneBtn').onclick = openPhone;

// ---------------- on launch: reopen the sessions that were running last time? ----------------
(async () => {
  const d = await window.api.restore.get();
  for (let i = 0; i < 240 && !snap.ready; i++) await new Promise(r => setTimeout(r, 250));   // wait (≤60 s) for the first live snapshot
  const live = new Set(snap.sessions.map(s => s.sid));
  const list = (d.sessions || []).filter(x => !live.has(x.sid));              // skip ones already running elsewhere
  if (!list.length) return window.api.restore.done();
  const reopen = async pick => {
    if (document.body.dataset.view === 'mesh') setView('split');
    for (const x of pick) {
      const id = x.kind === 'hermes' ? await newTerm({ kind: 'hermes', cwd: x.cwd, resumeSid: x.sid, name: x.name, title: (x.name || '').slice(0, 40) })   // a Hermes session reopens in Hermes
        : await newTerm({ kind: 'claude', cwd: x.cwd, flags: `${RESUME_FLAGS} --resume ${x.sid}`, title: (x.name || '').slice(0, 40) });
      autoTrust.set(id, { until: Date.now() + 20000, buf: '' });
      await new Promise(r => setTimeout(r, 600));                              // stagger the starts
    }
    toast(`Reopened ${pick.length} session${pick.length > 1 ? 's' : ''}`);
  };
  for (const x of d.shells || []) if (!(snap.ptys || []).some(p => p.cwd === x.cwd && p.kind === 'shell')) newTerm({ kind: 'shell', cwd: x.cwd, title: x.title });
  if (d.auto) { window.api.restore.done(); return reopen(list); }             // Window ▸ Reopen last sessions without asking (the default)
  modal(`<h2>Reopen last sessions?</h2>
    <div style="color:var(--dim);font-size:13px;margin-bottom:8px">${list.length} session${list.length > 1 ? 's were' : ' was'} running in ${APP_NAME} when it last closed${d.at ? ' (' + new Date(d.at).toLocaleString() + ')' : ''}.</div>
    <div class="rs-list">${list.map((x, i) => `<label class="chk"><input type="checkbox" data-rs="${i}" checked> <b>${esc(x.name || x.sid.slice(0, 8))}</b> <span style="color:var(--dim)">${esc((x.model || '').replace('claude-', ''))} · ${esc((x.cwd || '').replace(/^\/Users\/[^/]+/, '~'))}</span></label>`).join('')}</div>
    <div class="btns" style="justify-content:flex-end"><button id="rsNo">No</button><button class="primary" id="rsYes">Yes, reopen</button></div>`);
  const finish = () => { closeModal(); window.api.restore.done(); };
  $('#rsNo').onclick = finish;
  $('#rsYes').onclick = () => { const pick = list.filter((_, i) => document.querySelector(`[data-rs="${i}"]`).checked); finish(); reopen(pick); };
})();
