// Chat theme (2026-11-15): an optional look in which the Sessions panel is a messenger's chat list (one row per session:
// avatar, name, latest line, time, unread badge) and each session's terminal panel is a chat room (your prompts on the
// right, replies on the left, tool calls as one grey line each, an input bar that sends to the session). Picked in the
// mother star's menu (Theme), kept per machine (localStorage 'uiTheme'). Its label comes from mesh.local.json
// chatThemeName (default "Chat"). With the theme off this file draws nothing and every rule in chat-theme.css is scoped
// under body.chat-theme, so the default look is untouched.
// Data: the room reads the session's transcript tail (main.js chat:get → transcript-chat.js; a session on the other Mac
// through its /api/chat); a session without a Claude transcript (Hermes) shows its snapshot log instead.
// Pictures and files (2026-11-26): a prompt's pictures show without a bubble (several = a 2-column grid; click = a
// full-size viewer, Esc closes), attached files as a file card (type icon, name, size; missing = "파일 없음"); pictures
// come through main as scaled-down data URLs (chat:media). The input bar shows what you attach (+, drop, paste) as
// chips you can remove; sending puts their paths into the message as before. The View menu's Theme radio follows set().
// Light and dark (2026-11-26): the theme has three appearances, Light, Dark and Match System (localStorage 'uiTheme':
// 'chat' = light, 'chat-dark', 'chat-system'); body.ct-dark switches the palette. The whole main window follows it
// (header, the session board, the Terminals tabs, the dock), and the Sessions panel gets the messenger's left icon rail.
// Detached windows (2026-11-26): a room or the Sessions list can open in a window of its own (renderer/chatwin.html,
// which loads this file with window.CT_DETACHED = 'room' | 'sessions'); while one is out, its tab / panel leaves the
// main window and comes back when that window closes. See main.js "detached chat windows".
// Uses app.js globals: snap, selected, terms, termOf, select, sessSend, esc, toast, store, openCmdMenu, FAMILY_COLOR, ORB_PAL.
(function () {
  const NAME = (window.api && window.api.chatThemeName) || 'Chat';
  const DETACHED = window.CT_DETACHED || null;     // null = the main window
  const LS = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } } };
  const MODES = { chat: 'light', 'chat-dark': 'dark', 'chat-system': 'system' };
  let mode = MODES[LS.get('uiTheme', 'default')] || null;   // null = Default theme
  let on = !!mode;
  const sysDark = matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => mode === 'dark' || (mode === 'system' && sysDark.matches);
  const seenAt = LS.get('chat.seen', {});          // sid → epoch ms of the newest reply you have seen
  const detached = new Set();                      // main window: the keys of the windows that are out ('sessions', 'room:<sid>')
  const xtermOn = LS.get('chat.xterm', {});        // sid → 1: this session's panel shows the real terminal
  let filter = 'all', query = '', searchOpen = false, lastListHtml = '', lastClick = {};
  const rooms = new Map();                         // ptyId → room state

  // ---------- small helpers ----------
  const SVG = {
    search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l5 5"/></svg>',
    person: '<svg viewBox="0 0 24 24" class="fill"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5z"/></svg>',
    term: '<svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M7 10l3 2.5L7 15M12.5 15.5h4.5"/></svg>',
    menu: '<svg viewBox="0 0 24 24"><path d="M4 6.5h16M4 12h16M4 17.5h16"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 4v16M4 12h16"/></svg>',
    smile: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle class="fill" cx="9" cy="10" r="1.1"/><circle class="fill" cx="15" cy="10" r="1.1"/><path d="M8.5 14.2c1.9 2.2 5.1 2.2 7 0"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14.5 3.5V8H19"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M12 4.5c-5 0-8.5 3-8.5 6.8 0 2.4 1.4 4.4 3.6 5.6l-.8 3.1 3.5-2.1c.7.1 1.4.2 2.2.2 5 0 8.5-3 8.5-6.8S17 4.5 12 4.5z"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M6 9.5l6 6 6-6"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>',
    pop: '<svg viewBox="0 0 24 24"><rect x="3.5" y="7" width="13.5" height="13.5" rx="2.5"/><path d="M11 3.5h9.5V13M20.5 3.5L11.5 12.5"/></svg>',
    dock: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M3.5 9h17M12.5 13.5l-3 2.5 3 2.5M9.5 16h6"/></svg>',
    chats: '<svg viewBox="0 0 24 24" class="fill"><path d="M12 3.8c-5.2 0-9 3.2-9 7.2 0 2.5 1.5 4.7 3.8 6l-.9 3.4 3.8-2.3c.7.1 1.5.2 2.3.2 5.2 0 9-3.2 9-7.3S17.2 3.8 12 3.8z"/></svg>',
    people: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 19.5c0-3.6 2.9-5.8 6.5-5.8s6.5 2.2 6.5 5.8"/><path d="M15.5 5.3a3.4 3.4 0 0 1 0 6.4M18 14.2c2.2.6 3.5 2.5 3.5 5.3"/></svg>',
    usage: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    more: '<svg viewBox="0 0 24 24" class="fill"><circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></svg>',
    moon: '<svg viewBox="0 0 24 24"><path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/></svg>',
    sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M18 16.25V11a6 6 0 0 0-12 0v5.25L4.75 18h14.5z"/><path d="M10 20.75a2.1 2.1 0 0 0 4 0"/></svg>',
    doc: '<svg viewBox="0 0 24 24" class="fill"><path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" opacity=".95"/><path d="M14 3v5h5" fill="rgba(0,0,0,.18)"/></svg>',
  };
  // file-type colours for the file card's round icon
  const FTYPE = [[/^(pdf)$/, '#ef5350', 'PDF'], [/^(xlsx?|csv|numbers|tsv)$/, '#21a366', 'XLS'], [/^(docx?|pages|rtf|odt)$/, '#3b7ddd', 'DOC'],
    [/^(pptx?|key)$/, '#f0782d', 'PPT'], [/^(zip|gz|tgz|rar|7z|tar|dmg|pkg)$/, '#8e6ad8', 'ZIP'], [/^(mp4|mov|m4v|avi|mkv|webm)$/, '#e2457a', 'VID'],
    [/^(mp3|wav|m4a|aac|flac|ogg)$/, '#ff9f1a', 'AUD'], [/^(txt|md|log|json|ya?ml|xml|html?|css|js|ts|py|sh|gs|swift|java|c|cpp|go|rs|rb|sql)$/, '#6b7c93', 'TXT']];
  const ftype = name => { const e = (/\.([A-Za-z0-9]+)$/.exec(name) || [])[1] || ''; const f = FTYPE.find(([re]) => re.test(e.toLowerCase())); return f ? { c: f[1], t: e.slice(0, 4).toUpperCase() } : { c: '#8a99ad', t: (e || 'FILE').slice(0, 4).toUpperCase() }; };
  const fmtSize = n => n < 0 ? '파일 없음' : '용량 ' + (n < 1024 ? n + 'B' : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + 'KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + 'MB' : (n / 1073741824).toFixed(2) + 'GB');
  const IMG_RE = /\.(png|jpe?g|gif|webp|heic|bmp|tiff?)$/i;
  const media = new Map();                         // sid|key → { url, w, h } (thumbnails, this window's life)
  const EMO = ['👍', '🙏', '😊', '😂', '🤔', '👀', '✅', '❌', '🔥', '💡', '⏳', '❤️'];
  const sessions = () => (typeof snap !== 'undefined' && snap.sessions) || [];
  const sessByTerm = id => sessions().find(x => termOf(x) === id);
  // times as the messenger writes them: 오후 3:12 · 어제 · 11월 24일 · 2026년 11월 26일 목요일
  const fmtTime = t => new Date(t).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  function fmtWhen(t) {
    if (!t) return '';
    const d = new Date(t), now = new Date(), day = x => new Date(x).setHours(0, 0, 0, 0), dd = (day(now) - day(d)) / 864e5;
    if (dd <= 0) return fmtTime(t);
    if (dd === 1) return '어제';
    return d.toLocaleDateString('ko-KR', d.getFullYear() === now.getFullYear() ? { month: 'long', day: 'numeric' } : { year: 'numeric', month: 'numeric', day: 'numeric' });
  }
  const fmtDay = t => new Date(t).toLocaleDateString('ko-KR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  function colorOf(s) {
    try { if (s.color && typeof ORB_PAL !== 'undefined' && ORB_PAL[s.color]) return ORB_PAL[s.color].rim; } catch { }
    return (window.FAMILY_COLOR || {})[s.family] || '#9fb4d8';
  }
  const initial = s => { const m = String(s.name || '?').trim().match(/[\p{L}\p{N}]/u); return m ? m[0].toUpperCase() : '?'; };
  const avatar = (s, cls = '') => `<span class="ct-av${cls}" style="--av:${esc(colorOf(s))}"><b>${esc(initial(s))}</b></span>`;
  const lastT = s => { const l = s.log || [], t = l.length ? l[l.length - 1].t : 0; const u = s.sinceUse ?? s.sinceWrite; return Math.max(t || 0, u != null ? Date.now() - u * 1000 : 0); };
  // another window (a detached room or list) marked something seen: take it over so badges match everywhere
  addEventListener('storage', e => {
    if (e.key === 'chat.seen') { try { Object.assign(seenAt, JSON.parse(e.newValue || '{}')); lastListHtml = ''; if (on) { renderList(); repaintApp(); } } catch { } }
  });
  function unread(s) {
    if (!(s.sid in seenAt)) { seenAt[s.sid] = lastT(s); LS.set('chat.seen', seenAt); }
    return (s.log || []).filter(e => e.kind === 'claude' && e.t > seenAt[s.sid]).length;
  }
  function preview(s) {
    const l = (s.log || []).filter(e => e.kind === 'claude' || e.kind === 'you' || e.kind === 'err');
    const e = l[l.length - 1]; if (!e) { const t = (s.log || [])[s.log.length - 1]; return t ? t.text : ''; }
    return (e.kind === 'you' ? 'You: ' : '') + e.text;
  }

  // ---------- the chat list (Sessions panel) ----------
  function renderList() {
    const list = document.getElementById('list'); if (!list) return;
    const all = sessions().slice().sort((a, b) => lastT(b) - lastT(a));
    const U = new Map(all.map(s => [s.sid, unread(s)])), totalU = [...U.values()].reduce((a, b) => a + b, 0);
    const q = query.trim().toLowerCase();
    const shown = all.filter(s => (filter === 'unread' ? U.get(s.sid) > 0 || s.health === 'waiting' : filter === 'working' ? s.health === 'working' : true)
      && (!q || String(s.name || '').toLowerCase().includes(q) || preview(s).toLowerCase().includes(q)));
    const working = all.filter(s => s.health === 'working').length;
    const chip = (id, label, n) => `<button class="ct-chip${filter === id ? ' on' : ''}" data-chip="${id}">${label}${n ? `<i>${n > 999 ? '999+' : n}</i>` : ''}</button>`;
    const rows = shown.map(s => {
      const n = U.get(s.sid), host = s.hostLabel ? `<span class="ct-host">${esc(s.hostLabel)}${s.offline ? ' · offline' : ''}</span>` : '';
      const badge = n ? `<span class="ct-badge">${n > 300 ? '300+' : n}</span>` : s.health === 'waiting' ? '<span class="ct-badge dot" title="Waiting for you"></span>' : '';
      const typing = s.health === 'working' ? '<span class="ct-typing" title="Working"><i></i><i></i><i></i></span>' : '';
      const subs = s.subagents ? `<span class="ct-cnt">${s.subagents + 1}</span>` : '';
      return `<div class="ct-row${s.sid === selected ? ' sel' : ''}" data-sid="${esc(s.sid)}">${avatar(s)}
        <div class="ct-mid"><div class="ct-name"><span class="ct-n">${esc(s.name)}</span>${subs}${host}</div><div class="ct-prev">${esc(preview(s))}</div></div>
        <div class="ct-side"><span class="ct-time">${esc(fmtWhen(lastT(s)))}</span>${typing || badge}</div></div>`;
    }).join('');
    const html = `<div class="ct-head"><span class="ct-title">Chats</span><span class="ct-hbtn" data-search title="Search">${SVG.search}</span></div>`
      + (searchOpen ? `<div class="ct-search"><input id="ctQ" placeholder="Search chats" value="${esc(query)}"></div>` : '')
      + `<div class="ct-chips">${chip('all', 'All', 0)}${chip('unread', 'Unread', totalU)}${chip('working', 'Working', working)}</div>`
      + (rows || `<div class="ct-empty">${all.length ? 'No chats here.' : 'No sessions yet.'}</div>`);
    if (html === lastListHtml && list.firstElementChild && list.firstElementChild.classList.contains('ct-head')) return;
    lastListHtml = html;
    const st = list.scrollTop, hadFocus = document.activeElement && document.activeElement.id === 'ctQ', caret = hadFocus ? document.activeElement.selectionStart : 0;
    list.innerHTML = html; list.scrollTop = st;
    if (hadFocus) { const i = document.getElementById('ctQ'); i.focus(); i.setSelectionRange(caret, caret); }
    const cnt = document.getElementById('sessCount'); if (cnt) cnt.textContent = snap.ready ? `· ${all.length}` : '· reading…';
  }
  // one delegated set of handlers on #list; they only act on chat-list elements
  function wireList() {
    const list = document.getElementById('list'); if (!list || list._ct) return; list._ct = 1;
    list.addEventListener('click', e => {
      if (!on) return;
      const c = e.target.closest('[data-chip]'); if (c) { filter = c.dataset.chip; lastListHtml = ''; return renderList(); }
      if (e.target.closest('[data-search]')) { searchOpen = !searchOpen; if (!searchOpen) query = ''; lastListHtml = ''; renderList(); const i = document.getElementById('ctQ'); if (i) i.focus(); return; }
      // a second click within 450 ms at the same spot = double-click: that chat's room opens in a window of its own (like
      // the messenger). Timed here, and kept on the first click's chat, because the first click redraws the list (and
      // can move it), so the browser's dblclick often never fires or lands on another row.
      const r = e.target.closest('.ct-row'); if (!r) return;
      const now = Date.now();
      if (lastClick.sid && now - lastClick.t < 450 && Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < 8) { const sid = lastClick.sid; lastClick = {}; popRoom(sid); return; }
      lastClick = { sid: r.dataset.sid, t: now, x: e.clientX, y: e.clientY }; select(r.dataset.sid);
    });
    list.addEventListener('input', e => { if (on && e.target.id === 'ctQ') { query = e.target.value; renderList(); } });
    list.addEventListener('keydown', e => { if (on && e.target.id === 'ctQ' && e.key === 'Escape') { searchOpen = false; query = ''; lastListHtml = ''; renderList(); } });
    list.addEventListener('contextmenu', e => { if (!on) return; const r = e.target.closest('.ct-row'); if (r && typeof openCmdMenu === 'function') { e.preventDefault(); openCmdMenu(r.dataset.sid, e.clientX, e.clientY); } });
  }

  // ---------- chat rooms (terminal panels) ----------
  function makeRoom(id, t) {
    const el = document.createElement('div'); el.className = 'chatroom';
    el.innerHTML = `<div class="cr-head"><span class="cr-av"></span><div class="cr-who"><div class="cr-name"></div><div class="cr-sub"></div></div>
        <span class="cr-hb ct-main" data-a="pop" title="Open in its own window (or drag its tab out of the window)">${SVG.pop}</span><span class="cr-hb ct-main" data-a="term" title="Show the terminal">${SVG.term}</span><span class="cr-hb ct-main" data-a="menu" title="Commands">${SVG.menu}</span><span class="cr-hb ct-det" data-a="dock" title="Back into the main window">${SVG.dock}</span></div>
      <div class="cr-scroll"><div class="cr-msgs"></div><div class="cr-typing" hidden></div></div>
      <button class="cr-jump" hidden title="Newest messages">${SVG.down}</button>
      <div class="cr-input"><div class="cr-atts" hidden></div><div class="cr-tarow"><textarea rows="1" placeholder="메시지 입력" spellcheck="false"></textarea><button class="cr-send" disabled>전송</button></div>
        <div class="cr-bar"><span class="cr-ib" data-a="plus" title="Attach files (their paths go into the message)">${SVG.plus}</span><span class="cr-ib" data-a="emo" title="Emoji">${SVG.smile}</span><span class="cr-ib" data-a="file" title="Attach files">${SVG.file}</span>
        <span class="cr-sp"></span></div>
        <div class="cr-emo" hidden>${EMO.map(x => `<span>${x}</span>`).join('')}</div><input type="file" multiple hidden></div>`;
    const back = document.createElement('button'); back.className = 'cr-back'; back.title = 'Back to the chat room'; back.innerHTML = SVG.chat + '<span>Chat</span>';
    t.el.appendChild(el); t.el.appendChild(back);
    const R = { id, el, back, t, sid: null, keys: '', items: [], pending: [], att: [], open: new Set(), fetchAt: 0, busy: false, first: true,
      scroll: el.querySelector('.cr-scroll'), msgs: el.querySelector('.cr-msgs'), ta: el.querySelector('textarea'), send: el.querySelector('.cr-send') };
    const atBottom = () => R.scroll.scrollHeight - R.scroll.scrollTop - R.scroll.clientHeight < 40;
    R.atBottom = atBottom;
    R.stick = true;   // follow the newest message until you scroll up (only judged while the room is on screen)
    // only your own scrolling (wheel, keys, the scrollbar) lets go of the newest message; layout changes and pictures
    // arriving keep the room following it
    let userAt = 0; const touched = () => { userAt = performance.now(); };
    for (const ev of ['wheel', 'pointerdown', 'keydown', 'touchmove']) R.scroll.addEventListener(ev, touched, { passive: true });
    R.scroll.addEventListener('scroll', () => {
      if (!R.scroll.clientHeight) return;
      if (atBottom()) R.stick = true; else if (performance.now() - userAt < 800) R.stick = false; else if (R.stick) R.scroll.scrollTop = R.scroll.scrollHeight;
      el.querySelector('.cr-jump').hidden = R.stick || atBottom();
    });
    new ResizeObserver(() => { if (R.stick && R.scroll.clientHeight) R.scroll.scrollTop = R.scroll.scrollHeight; }).observe(R.msgs);
    new ResizeObserver(() => { if (R.stick && R.scroll.clientHeight) R.scroll.scrollTop = R.scroll.scrollHeight; }).observe(R.scroll);
    el.querySelector('.cr-jump').onclick = () => { R.scroll.scrollTop = R.scroll.scrollHeight; };
    const grow = () => { R.ta.style.height = 'auto'; R.ta.style.height = Math.min(140, R.ta.scrollHeight) + 'px'; R.send.disabled = !R.ta.value.trim() && !R.att.length; };
    R.grow = grow;
    R.ta.addEventListener('input', grow);
    R.ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); doSend(R); }
      e.stopPropagation();
    });
    R.send.onclick = () => doSend(R);
    // a pasted file or picture becomes an attachment chip (text pastes as text)
    R.ta.addEventListener('paste', async e => {
      // main reads the clipboard: Finder-copied files (whose text is only their name), screenshots / copied pictures
      // (saved as a PNG) or text. Files and pictures become chips; text goes in as text.
      e.preventDefault(); e.stopPropagation();
      let c = null; try { c = await window.api.clipRead(); } catch { }
      if (c && c.kind === 'files' && c.paths && c.paths.length) attach(R, c.paths.map(p => ({ p })));
      else if (c && c.text) insert(R, c.text);
      else { const t = e.clipboardData && e.clipboardData.getData('text/plain'); if (t) insert(R, t); }
    });
    el.querySelector('.cr-atts').addEventListener('click', e => { const x = e.target.closest('[data-rm]'); if (!x) return; R.att.splice(+x.dataset.rm, 1); drawAtts(R); R.ta.focus(); });
    const fileIn = el.querySelector('input[type=file]'), emo = el.querySelector('.cr-emo');
    fileIn.onchange = () => { addPaths(R, [...fileIn.files]); fileIn.value = ''; };
    el.querySelector('.cr-bar').addEventListener('click', e => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.a === 'emo') emo.hidden = !emo.hidden; else fileIn.click();
    });
    emo.addEventListener('click', e => { const x = e.target.closest('span'); if (!x) return; insert(R, x.textContent); emo.hidden = true; });
    el.querySelector('.cr-head').addEventListener('click', e => {
      const b = e.target.closest('[data-a]'); if (!b || !R.sid) return;
      if (b.dataset.a === 'term') setXterm(R, true);
      else if (b.dataset.a === 'pop') popRoom(R.sid);
      else if (b.dataset.a === 'dock') window.api.chatWin.dock();
      else if (typeof openCmdMenu === 'function') { const r = b.getBoundingClientRect(); openCmdMenu(R.sid, r.left, r.bottom + 4); }
    });
    back.onclick = () => setXterm(R, false);
    // files dropped into the room: their paths go into the message
    el.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.stopPropagation(); } });
    el.addEventListener('drop', e => { if (!e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); e.stopPropagation(); addPaths(R, [...e.dataTransfer.files]); });
    // the hidden terminal never takes the keyboard while the room covers it: typing would go to the session unseen
    const ta = t.term && t.term.textarea;
    if (ta) ta.addEventListener('focus', () => { if (roomShown(R)) setTimeout(() => R.ta.focus(), 0); });
    el.addEventListener('mousedown', () => { try { activeTerm = id; } catch { } });
    return R;
  }
  function insert(R, s) { const a = R.ta.selectionStart ?? R.ta.value.length, b = R.ta.selectionEnd ?? a; R.ta.value = R.ta.value.slice(0, a) + s + R.ta.value.slice(b); R.ta.focus(); R.ta.selectionStart = R.ta.selectionEnd = a + s.length; R.grow(); }
  // attachments wait as chips above the text until you send
  function addPaths(R, files) {
    attach(R, files.map(f => { let p = ''; try { p = window.api.pathForFile(f); } catch { } return p && { p, size: f.size }; }).filter(Boolean));
  }
  async function attach(R, list) {
    for (const a of list) if (a.p && !R.att.some(x => x.p === a.p) && R.att.length < 30) R.att.push({ p: a.p, name: a.p.split('/').pop(), size: a.size, img: IMG_RE.test(a.p) });
    const need = R.att.filter(a => a.size == null);
    if (need.length) { try { const sz = await window.api.chatStat(need.map(a => a.p)); need.forEach((a, i) => { a.size = sz[i]; }); } catch { } }
    drawAtts(R); R.ta.focus();
  }
  function drawAtts(R) {
    const box = R.el.querySelector('.cr-atts');
    box.hidden = !R.att.length;
    box.innerHTML = R.att.map((a, i) => {
      const th = a.img && media.get('local|' + a.p), ft = ftype(a.name);
      return `<span class="cr-att${a.img ? ' img' : ''}" title="${esc(a.p)}">${a.img ? `<img alt=""${th ? ` src="${th.url}"` : ''} data-lp="${esc(a.p)}">`
        : `<i class="cr-ficon sm" style="--fc:${ft.c}">${SVG.doc}</i><span class="cr-attn"><b>${esc(a.name)}</b><small>${esc(fmtSize(a.size ?? -1))}</small></span>`}<button data-rm="${i}" title="Remove">${SVG.x}</button></span>`;
    }).join('');
    for (const img of box.querySelectorAll('img[data-lp]:not([src])')) { const p = img.dataset.lp;
      window.api.chatThumb(p).then(r => { if (r) { media.set('local|' + p, r); img.src = r.url; } }).catch(() => { }); }
    R.grow();
  }
  function setXterm(R, v) {
    if (!R.sid) return;
    if (v) xtermOn[R.sid] = 1; else delete xtermOn[R.sid];
    LS.set('chat.xterm', xtermOn); apply(R);
    requestAnimationFrame(() => { if (v) { try { typeof fitAll === 'function' && fitAll(); R.t.term.scrollToBottom(); R.t.term.focus(); } catch { } } else { R.scroll.scrollTop = R.scroll.scrollHeight; R.ta.focus(); } });
  }
  const roomShown = R => on && R.sid && !xtermOn[R.sid];
  function apply(R) {
    const shown = roomShown(R);
    R.t.el.classList.toggle('chat-room', !!shown);
    R.t.el.classList.toggle('chat-xterm', !!(on && R.sid && xtermOn[R.sid]));
  }
  async function doSend(R) {
    const typed = R.ta.value.replace(/\s+$/, ''), att = R.att.slice(); if (!typed.trim() && !att.length) return;
    const s = sessions().find(x => x.sid === R.sid); if (!s) return toast('This session is not running');
    const q = p => /\s/.test(p) ? `"${p}"` : p;
    // a session on the other Mac gets copies of the files there (the paths here mean nothing to it)
    let sendPaths = att.map(a => a.p);
    if (s.onPeer && sendPaths.length) { const u = await window.api.peer.upload(sendPaths).catch(e => ({ err: e.message })); if (u.err) return toast("Couldn't send the file: " + u.err); sendPaths = u.paths; }
    const text = [typed, ...sendPaths.map(q)].filter(Boolean).join(' ');
    R.ta.value = ''; R.att = []; drawAtts(R);
    const p = { id: 'p' + Date.now(), t: Date.now(), k: 'u', x: typed.trim(), pending: true,
      imgs: att.filter(a => a.img).map(a => ({ key: 'local:' + a.p })), files: att.filter(a => !a.img).map(a => ({ p: a.p, name: a.name, size: a.size ?? -1 })) };
    if (!p.imgs.length) delete p.imgs; if (!p.files.length) delete p.files;
    R.pending.push(p); draw(R, true);
    R.scroll.scrollTop = R.scroll.scrollHeight;
    let r; try { r = await sessSend(s, text); } catch (e) { r = { ok: false, err: e.message }; }
    if (r && r.ok === false) { p.failed = r.err || 'not sent'; draw(R, false); toast('Not sent: ' + (r.err || 'unknown')); }
    R.fetchAt = 0; setTimeout(() => refresh(R, true), 700);
  }

  // the messages: transcript tail, or the snapshot log for a session without one
  const fromLog = s => (s.log || []).map((e, i) => ({ id: 'l' + i + ':' + e.t, t: e.t, k: e.kind === 'you' ? 'u' : e.kind === 'claude' ? 'a' : 'tool', x: e.text }));
  async function refresh(R, force) {
    const s = sessions().find(x => x.sid === R.sid); if (!s || R.busy) return;
    if (!force && Date.now() - R.fetchAt < 1500) return;
    R.fetchAt = Date.now(); R.busy = true;
    let items = null;
    try { if (s.kind !== 'hermes' && s.engine !== 'hermes') items = await window.api.chat(s.sid, 150); } catch { }
    R.busy = false;
    if (!Array.isArray(items) || !items.length) items = fromLog(s);
    if (R.sid !== s.sid) return;
    R.items = items;
    // a sent message stays as a pending bubble until the transcript has it (or for a minute)
    R.pending = R.pending.filter(p => !p.failed ? Date.now() - p.t < 60000 && !items.some(m => m.k === 'u' && m.t >= p.t - 5000 && m.x.trim() === p.x.trim() && !!(m.imgs || m.files) === !!(p.imgs || p.files)) : Date.now() - p.t < 30000);
    draw(R, false);
  }
  function draw(R, force) {
    const s = sessions().find(x => x.sid === R.sid); if (!s) return;
    const all = parts(R.items.concat(R.pending)), keys = all.map(m => m.id + (m.failed ? '!' : '')).join('|') + '#' + [...R.open].join(',');
    const typing = s.health === 'working';
    const ty = R.el.querySelector('.cr-typing');
    if (ty.hidden === typing) { ty.hidden = !typing; ty.innerHTML = typing ? `${avatar(s, ' sm')}<span class="cr-dots"><i></i><i></i><i></i></span>` : ''; if (typing && R.stick) R.scroll.scrollTop = R.scroll.scrollHeight; }
    if (!force && keys === R.keys) return;
    const prev = new Set(R.keys ? R.keys.split('#')[0].split('|').map(k => k.replace(/!$/, '')) : []), animate = !R.first;
    const wasBottom = R.first || R.stick || !R.msgs.querySelector('.cr-msg'), st = R.scroll.scrollTop;   // an empty room opens at its newest
    R.keys = keys; R.first = false;
    const out = []; let lastDay = '';
    for (let i = 0; i < all.length; i++) {
      const m = all[i], nx = all[i + 1], pv = all[i - 1], neu = animate && !prev.has(m.id) ? ' neu' : '';
      const day = m.t ? new Date(m.t).toDateString() : lastDay;
      if (day !== lastDay && m.t) { out.push(`<div class="cr-day"><span>${esc(fmtDay(m.t))}</span></div>`); lastDay = day; }
      if (m.k === 'tool') {
        // a run of tool calls: one grey line each, a long run folded after three
        let j = i; while (all[j + 1] && all[j + 1].k === 'tool') j++;
        const run = all.slice(i, j + 1), key = run[0].id, open = R.open.has(key) || run.length <= 4;
        const show = open ? run : run.slice(0, 3);
        for (const x of show) out.push(`<div class="cr-sys${animate && !prev.has(x.id) ? ' neu' : ''}"><span title="${esc(x.x)}">${esc(x.x)}</span></div>`);
        if (!open) out.push(`<div class="cr-sys more" data-open="${esc(key)}"><span>+ ${run.length - 3} more tool calls</span></div>`);
        i = j; continue;
      }
      const sameMin = (a, b) => a && b && a.k === b.k && Math.floor(a.t / 6e4) === Math.floor(b.t / 6e4);
      const firstOfRun = !(pv && pv.k === m.k && new Date(pv.t).toDateString() === day), lastOfMin = !sameMin(m, nx);
      // the messenger's read count: a "1" beside your message until the session has it in its transcript
      const time = m.pending && !m.failed && m.k === 'u' ? `<span class="cr-t"><b class="cr-rc" title="Not read by the session yet">1</b></span>`
        : lastOfMin && m.t ? `<span class="cr-t">${m.failed ? 'Not sent' : m.pending ? '' : esc(fmtTime(m.t))}</span>` : '';
      let inner, kind = '';
      if (m.part === 'img') { inner = imgGrid(R, s, m); kind = ' pic'; }
      else if (m.part === 'file') { inner = fileCard(m.f); kind = ' att'; }
      else {
        const long = m.x.length > 900 && !R.open.has(m.id), cut = long ? m.x.slice(0, 700).replace(/\s+\S*$/, '') + '…' : m.x;
        const body = m.k === 'a' && typeof mdToHtml === 'function' ? mdToHtml(cut) : esc(cut);
        const more = long ? `<div class="cr-more" data-open="${esc(m.id)}">See more</div>` : '';
        inner = `<div class="cr-bub${m.k === 'a' ? ' md' : ''}">${body}${more}</div>`;
      }
      const cls = `${firstOfRun ? ' first' : ''}${m.pending ? ' pending' : ''}${m.failed ? ' failed' : ''}${kind}${neu}`;
      if (m.k === 'u') out.push(`<div class="cr-msg me${cls}">${time}${inner}</div>`);
      else out.push(`<div class="cr-msg them${cls}">${firstOfRun ? avatar(s) : '<span class="ct-av ghost"></span>'}<div class="cr-col">${firstOfRun ? `<div class="cr-from">${esc(s.name)}</div>` : ''}<div class="cr-line">${inner}${time}</div></div></div>`);
    }
    if (!all.length) out.push(`<div class="cr-empty">No messages yet. Say hello below.</div>`);
    R.msgs.innerHTML = out.join('');
    loadPics(R, s);
    R.scroll.scrollTop = wasBottom ? R.scroll.scrollHeight : st;
    R.el.querySelector('.cr-jump').hidden = !R.scroll.clientHeight || R.atBottom();
  }
  // one chat item → its parts, each drawn as its own row like the messenger does: the text, the pictures (one grid), each file
  function parts(list) {
    const out = [];
    for (const m of list) {
      if (m.k === 'tool' || (!m.imgs && !m.files)) { out.push(m); continue; }
      if (m.x && m.x.trim()) out.push({ ...m, imgs: null, files: null });
      if (m.imgs && m.imgs.length) out.push({ ...m, id: m.id + '#i', part: 'img', x: '' });
      for (const [i, f] of (m.files || []).entries()) out.push({ ...m, id: m.id + '#f' + i, part: 'file', f, x: '' });
    }
    return out;
  }
  const picUrl = (sid, key) => media.get(key.startsWith('local:') ? 'local|' + key.slice(6) : sid + '|' + key);
  // one picture's box: at most 240 wide and 360 tall, its shape kept
  const picBox = r => { const sc = Math.min(1, 240 / Math.max(1, r.w), 360 / Math.max(1, r.h)); return [Math.max(40, Math.round(r.w * sc)), Math.max(40, Math.round(r.h * sc))]; };
  function imgGrid(R, s, m) {
    const ims = m.imgs, n = ims.length;
    if (n === 1) {   // one picture: its own shape, at most 240 px wide
      const k = ims[0].key, r = picUrl(s.sid, k), [w, h] = r ? picBox(r) : [200, 150];
      return `<div class="cr-pics one"><img class="cr-pic" data-key="${esc(k)}" data-mid="${esc(m.id)}" data-i="0" alt="" style="width:${w}px;height:${h}px"${r ? ` src="${r.url}"` : ''}></div>`;
    }
    return `<div class="cr-pics grid${n % 2 ? ' odd' : ''}">` + ims.map((x, i) => { const r = picUrl(s.sid, x.key);
      return `<img class="cr-pic" data-key="${esc(x.key)}" data-mid="${esc(m.id)}" data-i="${i}" alt=""${r ? ` src="${r.url}"` : ''}>`; }).join('') + '</div>';
  }
  function fileCard(f) {
    const ft = ftype(f.name);
    return `<div class="cr-file${f.size < 0 ? ' gone' : ''}" data-fp="${esc(f.p)}" title="${esc(f.p)}"><i class="cr-ficon" style="--fc:${ft.c}" title="${esc(ft.t)}">${SVG.doc}</i>`
      + `<span class="cr-fmeta"><b>${esc(f.name)}</b><small>${esc(fmtSize(f.size))}</small></span></div>`;
  }
  // fetch the pictures that aren't loaded yet (one call each; main caches them too)
  function loadPics(R, s) {
    for (const img of R.msgs.querySelectorAll('img.cr-pic:not([src])')) {
      const k = img.dataset.key, local = k.startsWith('local:');
      const p = local ? window.api.chatThumb(k.slice(6)) : window.api.chatMedia(s.sid, k, false);
      p.then(r => {
        if (!r || !r.url) { img.classList.add('broken'); return; }
        media.set(local ? 'local|' + k.slice(6) : s.sid + '|' + k, r);
        if (img.closest('.one')) { const [w, h] = picBox(r); img.style.width = w + 'px'; img.style.height = h + 'px'; }
        img.src = r.url;
      }).catch(() => img.classList.add('broken'));
    }
  }
  // the full-size viewer: the thumbnail at once, the full picture when it arrives; ← → between a message's pictures
  let viewer = null;
  function openViewer(R, s, keys, i) {
    closeViewer();
    const v = document.createElement('div'); v.className = 'cr-viewer';
    v.innerHTML = `<img alt=""><button class="cr-vx" title="Close (Esc)">${SVG.x}</button>${keys.length > 1 ? '<button class="cr-vp" data-d="-1">‹</button><button class="cr-vn" data-d="1">›</button><span class="cr-vc"></span>' : ''}`;
    document.body.appendChild(v); viewer = { v, keys, i, s };
    const show = () => {
      const k = viewer.keys[viewer.i], img = v.querySelector('img'), th = picUrl(s.sid, k), my = viewer.i;
      img.src = th ? th.url : ''; const c = v.querySelector('.cr-vc'); if (c) c.textContent = `${viewer.i + 1} / ${viewer.keys.length}`;
      const full = k.startsWith('local:') ? null : window.api.chatMedia(s.sid, k, true);
      if (full) full.then(r => { if (r && r.url && viewer && viewer.i === my && viewer.v === v) img.src = r.url; }).catch(() => { });
    };
    viewer.show = show; show();
    v.addEventListener('click', e => { const d = e.target.closest('[data-d]'); if (d) { viewer.i = (viewer.i + +d.dataset.d + keys.length) % keys.length; return show(); } if (e.target.tagName !== 'IMG') closeViewer(); });
  }
  function closeViewer() { if (viewer) { viewer.v.remove(); viewer = null; } }
  addEventListener('keydown', e => {
    if (!viewer) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeViewer(); }
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && viewer.keys.length > 1) { e.preventDefault(); e.stopPropagation(); viewer.i = (viewer.i + (e.key === 'ArrowLeft' ? -1 : 1) + viewer.keys.length) % viewer.keys.length; viewer.show(); }
  }, true);
  function head(R, s) {
    const k = [s.name, s.health, colorOf(s), s.model, s.subagents, s.hostLabel].join('|'); if (R.headKey === k) return; R.headKey = k;
    R.el.querySelector('.cr-av').innerHTML = avatar(s);
    R.el.querySelector('.cr-name').textContent = s.name;
    R.el.querySelector('.cr-sub').innerHTML = `${SVG.person}<span>${2 + (s.subagents || 0)}</span>${s.model ? `<span class="cr-model">${esc(String(s.model).replace('claude-', ''))}</span>` : ''}${s.hostLabel ? `<span class="cr-model">${esc(s.hostLabel)}</span>` : ''}`;
    R.back.querySelector('span').textContent = NAME;
  }
  function syncRooms() {
    if (typeof terms === 'undefined') return;
    for (const [id, t] of terms) {
      let R = rooms.get(id);
      const s = sessByTerm(id);
      if (!on) { if (R) apply(R); continue; }
      if (!s) { if (R) { R.sid = null; apply(R); } continue; }
      if (!R || !R.el.isConnected) { R = makeRoom(id, t); rooms.set(id, R); }
      if (R.sid !== s.sid) { R.sid = s.sid; R.stick = true; R.keys = ''; R.items = []; R.pending = []; R.first = true; R.headKey = ''; R.msgs.innerHTML = ''; }
      apply(R); head(R, s);
      const visible = roomShown(R) && !t.tabHidden && !document.hidden && (document.body.dataset.view === 'grid' || t.el.classList.contains('on'));
      if (visible) { refresh(R); draw(R, false); if (R.stick && !R.atBottom()) R.scroll.scrollTop = R.scroll.scrollHeight; if ((DETACHED || id === activeTerm) && document.hasFocus()) markSeen(s); }
    }
    for (const [id, R] of rooms) if (!terms.has(id)) { R.el.remove(); R.back.remove(); rooms.delete(id); }
  }
  function markSeen(s) { const t = lastT(s); if (!seenAt[s.sid] || seenAt[s.sid] < t) { seenAt[s.sid] = t; LS.set('chat.seen', seenAt); } }
  // clicks inside a room's messages: "See more" and folded tool runs
  document.addEventListener('click', e => {
    const pic = e.target.closest('.chatroom img.cr-pic'), card = e.target.closest('.chatroom .cr-file'), o = e.target.closest('.chatroom [data-open]');
    if (!pic && !card && !o) return;
    const R = [...rooms.values()].find(r => r.el.contains(pic || card || o)); if (!R) return;
    const s = sessions().find(x => x.sid === R.sid);
    if (pic) { if (!s || !pic.src) return; const keys = [...pic.closest('.cr-pics').querySelectorAll('img.cr-pic')].map(x => x.dataset.key); return openViewer(R, s, keys, +pic.dataset.i || 0); }
    if (card) { if (card.classList.contains('gone')) return toast('파일 없음'); if (s && s.onPeer) return toast(`This file is on ${s.hostLabel || 'the other Mac'}`);
      return window.api.chatReveal(card.dataset.fp).then(ok => ok || toast('파일 없음')); }
    R.open.add(o.dataset.open); draw(R, true);
  });

  // ---------- detached windows ----------
  // main window: open a session's room in its own window (double-click in the list, the room's pop-out button, or a tab
  // dragged out of the window); `at` = where the pointer let go, in screen pixels
  function popRoom(sid, at) {
    if (!on || !sid) return false;
    if (DETACHED === 'room') return false;
    window.api.chatWin.open('room:' + sid, at || null).then(ok => { if (!ok) toast("Couldn't open the window"); }).catch(() => { });
    return true;
  }
  function popSessions(at) { if (!on || DETACHED) return false; window.api.chatWin.open('sessions', at || null).catch(() => { }); return true; }
  const roomKeyOfTerm = id => { const s = sessByTerm(id); return s ? 'room:' + s.sid : null; };
  // the main window lets go of what is out: the room's tab leaves the Terminals row, the Sessions panel leaves the dock;
  // both come back when their window closes
  function applyDetached() {
    if (DETACHED || typeof terms === 'undefined') return;
    let changed = false;
    for (const [id, t] of terms) {
      const k = roomKeyOfTerm(id), out = !!(on && k && detached.has(k));
      if (out && !t._ctOut) {
        t._ctOut = true; t.tabHidden = true; t.el.classList.add('tab-hidden'); t.el.classList.remove('on'); changed = true;
        if (activeTerm === id) { try { activeTerm = visibleTerms().pop() || null; } catch { } }
      } else if (!out && t._ctOut) { t._ctOut = false; t.tabHidden = false; t.el.classList.remove('tab-hidden'); changed = true; }
    }
    if (changed) { try { if (activeTerm && terms.get(activeTerm) && !terms.get(activeTerm).tabHidden) activate(activeTerm); else renderTabs(); document.getElementById('noTerms').style.display = visibleTerms().length ? 'none' : ''; layoutGrid(); } catch { } }
    const D = window.meshDock;
    if (D && D.isMounted && D.isMounted()) D.autoHide('sessions', on && detached.has('sessions'));
  }
  function onDetachedState(keys) {
    detached.clear(); for (const k of keys || []) detached.add(k);
    applyDetached(); lastListHtml = ''; if (on) renderList();
  }
  // a tab dragged out of the window (app.js Terminals tabs, dock.js panel tabs): true = it became a window
  function tearOff(kind, id, ev) {
    if (!on || DETACHED) return false;
    const at = ev && isFinite(ev.screenX) ? { x: ev.screenX, y: ev.screenY } : null;
    if (kind === 'panel') return id === 'sessions' ? popSessions(at) : false;
    const k = roomKeyOfTerm(id); return k ? popRoom(k.slice(5), at) : false;
  }
  const outside = ev => ev.clientX < 0 || ev.clientY < 0 || ev.clientX > innerWidth || ev.clientY > innerHeight;

  // ---------- the left icon rail (main window's Sessions panel and the detached list) ----------
  let railEl = null, railBox = null;
  function railHtml() {
    const dk = isDark(), b = (a, ic, title, cls = '') => `<span class="ct-ri${cls}" data-r="${a}" title="${esc(title)}">${ic}</span>`;
    return b('chats', SVG.chats, 'Chats', ' on')
      + (DETACHED ? '' : b('new', SVG.plus, 'New session (⌘T)') + b('usage', SVG.usage, 'Token usage'))
      + '<span class="ct-rsp"></span>'
      + (DETACHED ? b('dock', SVG.dock, 'Back into the main window') : b('pop', SVG.pop, 'Open the chat list in its own window (or drag the Sessions tab out of the window)'))
      + b('mode', dk ? SVG.sun : SVG.moon, dk ? 'Light' : 'Dark')
      + (DETACHED ? '' : b('bell', SVG.bell, 'Notify when a session finishes or errors') + b('more', SVG.more, 'More (the star menu: theme, broadcast, usage, switches)'));
  }
  function mountRail() {
    const side = document.getElementById('side'); if (!side) return;
    if (!on) { if (railEl) { const kids = [...railBox.childNodes]; for (const k of kids) side.insertBefore(k, railEl); railEl.remove(); railBox.remove(); railEl = railBox = null; } return; }
    if (!railEl) {
      railEl = document.createElement('nav'); railEl.className = 'ct-rail';
      railBox = document.createElement('div'); railBox.className = 'ct-sidebox';
      while (side.firstChild) railBox.appendChild(side.firstChild);
      side.append(railEl, railBox);
      railEl.addEventListener('click', e => {
        const r = e.target.closest('[data-r]'); if (!r) return; const a = r.dataset.r;
        if (a === 'chats') railBox.scrollTop = 0;
        else if (a === 'new') { try { openNew(); } catch { } }
        else if (a === 'usage') { try { openUsage(); } catch { } }
        else if (a === 'pop') popSessions(null);
        else if (a === 'dock') window.api.chatWin.dock();
        else if (a === 'mode') set(isDark() ? 'light' : 'dark');
        else if (a === 'bell') { const x = document.getElementById('bell'); if (x) x.click(); paintRail(); }
        else if (a === 'more') { try { const q = r.getBoundingClientRect(); lastPointer = { x: q.right, y: Math.max(8, q.top - 260) }; openStarMenu(); } catch { } }
      });
    }
    paintRail();
  }
  function paintRail() {
    if (!railEl) return; const h = railHtml(); if (railEl._h !== h) { railEl._h = h; railEl.innerHTML = h; }
    const bell = document.getElementById('bell'), rb = railEl.querySelector('[data-r="bell"]');
    if (rb && bell) rb.classList.toggle('off', !bell.classList.contains('on'));
  }
  // the board and the tabs (app.js) ask for these while the theme is on
  const repaintApp = () => { try { typeof renderBoard === 'function' && (lastBoard = '', renderBoard()); } catch { } try { typeof renderTabs === 'function' && renderTabs(); } catch { } };
  const badgeOf = s => { const n = unread(s); return n ? `<span class="ct-badge">${n > 300 ? '300+' : n}</span>` : ''; };

  // ---------- switching ----------
  // v: 'default' | 'light' | 'dark' | 'system' (true / false from older callers = light / default)
  function set(v, quiet) {
    const m = v === true ? (mode || 'light') : v === false ? null : ['light', 'dark', 'system'].includes(v) ? v : null;
    const was = mode, wasOn = on; mode = m; on = !!m;
    LS.set('uiTheme', !m ? 'default' : m === 'light' ? 'chat' : 'chat-' + m);
    document.body.classList.toggle('chat-theme', on);
    paintMode();
    lastListHtml = '';
    if (DETACHED !== 'room') mountRail();
    syncRooms(); applyDetached();
    renderListApp();   // the list redraws in whichever look is on now (app.js renderList hands over to us while the theme is on)
    if (!DETACHED && wasOn !== on) repaintApp();
    if (!on) closeViewer();
    if (!quiet) { try { window.api.themeState(m || 'default'); } catch { } }
    if (!quiet && typeof toast === 'function' && was !== m) toast(on ? `Theme: ${NAME} ${{ light: 'Light', dark: 'Dark', system: '(Match System)' }[m]}` : 'Theme: Default');
    requestAnimationFrame(() => { try { typeof fitAll === 'function' && fitAll(); } catch { } });
  }
  function paintMode() { document.body.classList.toggle('ct-dark', on && isDark()); paintRail(); }
  sysDark.addEventListener('change', () => { if (mode === 'system') paintMode(); });
  const renderListApp = () => { try { window.renderList && window.renderList(); } catch { } };   // app.js's renderList (ours shadows the name here)

  window.chatTheme = {
    name: NAME,
    get on() { return on; },
    get mode() { return on ? mode : 'default'; },
    get dark() { return on && isDark(); },
    set,
    renderList,
    update() { if (on && DETACHED !== 'room') { renderList(); paintRail(); } syncRooms(); applyDetached(); },
    seen(sid) { const s = sessions().find(x => x.sid === sid); if (s && on) { markSeen(s); lastListHtml = ''; } },
    // add files (paths) to a session's input bar as attachments
    attach(sid, paths) { const R = [...rooms.values()].find(r => r.sid === sid); if (R && Array.isArray(paths)) attach(R, paths.map(p => ({ p: String(p) }))); return !!R; },
    avatar: (s, cls) => avatar(s, cls ? ' ' + cls : ''), badge: badgeOf,
    // detached windows
    popRoom, popSessions, tearOff, outside,
    isOut: id => !!(terms.get(id) && terms.get(id)._ctOut),
    focusOut: id => { const k = roomKeyOfTerm(id); if (k) window.api.chatWin.open(k); },
  };
  wireList();
  if (!DETACHED) {
    try { window.api.themeState(on ? mode : 'default'); } catch { }
    try { window.api.chatWin.onState(onDetachedState); window.api.chatWin.list().then(onDetachedState).catch(() => { }); } catch { }
    try { window.api.chatWin.onSelect(sid => { const s = sessions().find(x => x.sid === sid); if (s) select(sid); }); } catch { }
  }
  try { window.api.onThemeSet(v => { const m = v === true ? 'light' : v === false ? 'default' : v; if (m !== (on ? mode : 'default')) set(m, true); }); } catch { }
  if (on) { document.body.classList.add('chat-theme'); paintMode(); if (DETACHED !== 'room') mountRail();
    // the first draw waits for the page's other scripts (md.js draws the replies' markdown)
    const boot = () => { renderListApp(); syncRooms(); if (!DETACHED) repaintApp(); };
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot, { once: true }); else setTimeout(boot, 0); }
})();
