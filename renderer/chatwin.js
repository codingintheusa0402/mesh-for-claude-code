// A detached chat window (2026-11-26, chat theme): one session's chat room (?room=<sid>) or the Sessions list
// (?panel=sessions). It loads chat-theme.js, which draws the list and the room exactly as in the main window (same
// transcript, send, attach and paste paths, sessions on the other Mac included); this file provides the few app.js
// globals that chat-theme.js uses. Snapshots come from main only while this window is visible (main.js sendChatWin).
// Closing the window, or its dock-back button, puts the room / list back into the main window.
const Q = new URLSearchParams(location.search);
const ROOM = Q.get('room') || null;
window.CT_DETACHED = ROOM ? 'room' : 'sessions';
document.body.classList.add(ROOM ? 'ct-win-room' : 'ct-win-list');
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } } };
let snap = { sessions: [], ready: false };
let selected = null, activeTerm = ROOM ? 'cw' : null;
// the room's host stands in for a terminal panel; the list window has none
const terms = new Map(ROOM ? [['cw', { el: $('#roomHost'), term: null, title: '' }]] : []);
const termOf = s => (ROOM && s && s.sid === ROOM ? 'cw' : null);
// avatar colours: the session's picked colour (organism.js ORB_PAL rims) or its model family (mesh.js FAMILY_COLOR)
const FAMILY_COLOR = { fable: '#ff5c8a', mythos: '#ff5c8a', opus: '#7d7bff', sonnet: '#2ef0a8', haiku: '#ffb347', other: '#9fb4d8' };
window.FAMILY_COLOR = FAMILY_COLOR;
const ORB_PAL = { c1: { rim: '#5ef2d6' }, c2: { rim: '#a98bff' }, c3: { rim: '#ffb547' }, c4: { rim: '#ff6fa8' }, c5: { rim: '#7cc8ff' } };
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600); }
// the same one path for every session as app.js sessSend: in-app terminal, Terminal.app tab, or the other Mac
function sessSend(s, text) {
  if (s.onPeer) return window.api.peer.send(s.sid, text);
  return s.owner ? window.api.ctl.send(s.owner, text, true) : window.api.ext.send(s.tty, text);
}
// a click in the detached list: it is selected here and in the main window (its room comes to the front there)
function select(sid) { selected = sid; try { window.api.chatWin.select(sid); } catch { } if (window.chatTheme) window.chatTheme.renderList(); }
// an error is shown in the window and logged by main (userData/chatwin.log), never a silent blank window
function showErr(msg) {
  try { window.api.chatWin.error(msg); } catch { }
  const gone = $('#cwGone'); if (!gone) return;
  gone.hidden = false; gone.querySelector('b').textContent = 'Something went wrong in this window';
  gone.querySelector('span').textContent = String(msg).slice(0, 300);
}
addEventListener('error', e => showErr((e.message || 'error') + (e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : '')));
addEventListener('unhandledrejection', e => showErr('unhandled: ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason)));
addEventListener('DOMContentLoaded', () => {
  $('#cwDockBtn').onclick = () => window.api.chatWin.dock();
  const onSnap = s => {
    if (!s) return;
    snap = s;
    if (ROOM) {
      const me = (s.sessions || [])[0];
      document.title = me ? me.name : 'Chat';
      const gone = $('#cwGone'); gone.hidden = !s.ready || !!me; if (!gone.hidden && !gone.querySelector('b').textContent) gone.querySelector('b').textContent = document.title;
    } else document.title = 'Chats';
    try { if (window.chatTheme) window.chatTheme.update(); } catch (e) { showErr(e.stack || e.message); }
  };
  window.api.onTelemetry(onSnap);
  // don't wait for the next push: ask now, and again shortly in case main had nothing yet
  const ask = () => window.api.chatWin.snap().then(s => { if (s && !snap.ready) onSnap(s); }).catch(e => showErr(e.message));
  ask(); setTimeout(ask, 1500);
  // ⌘W closes (= docks back) like any window; Esc in a room does nothing special
});
