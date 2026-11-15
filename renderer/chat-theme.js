// Chat theme (2026-11-15): an optional look in which the Sessions panel is a messenger's chat list (one row per session:
// avatar, name, latest line, time, unread badge) and each session's terminal panel is a chat room (your prompts on the
// right, replies on the left, tool calls as one grey line each, an input bar that sends to the session). Picked in the
// mother star's menu (Theme), kept per machine (localStorage 'uiTheme'). Its label comes from mesh.local.json
// chatThemeName (default "Chat"). With the theme off this file draws nothing and every rule in chat-theme.css is scoped
// under body.chat-theme, so the default look is untouched.
// Data: the room reads the session's transcript tail (main.js chat:get → transcript-chat.js; a session on the other Mac
// through its /api/chat); a session without a Claude transcript (Hermes) shows its snapshot log instead.
// Uses app.js globals: snap, selected, terms, termOf, select, sessSend, esc, toast, store, openCmdMenu, FAMILY_COLOR, ORB_PAL.
(function () {
  const NAME = (window.api && window.api.chatThemeName) || 'Chat';
  const LS = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } } };
  let on = LS.get('uiTheme', 'default') === 'chat';
  const seenAt = LS.get('chat.seen', {});          // sid → epoch ms of the newest reply you have seen
  const xtermOn = LS.get('chat.xterm', {});        // sid → 1: this session's panel shows the real terminal
  let filter = 'all', query = '', searchOpen = false, lastListHtml = '';
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
  };
  const EMO = ['👍', '🙏', '😊', '😂', '🤔', '👀', '✅', '❌', '🔥', '💡', '⏳', '❤️'];
  const sessions = () => (typeof snap !== 'undefined' && snap.sessions) || [];
  const sessByTerm = id => sessions().find(x => termOf(x) === id);
  const fmtTime = t => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  function fmtWhen(t) {
    if (!t) return '';
    const d = new Date(t), now = new Date(), day = x => new Date(x).setHours(0, 0, 0, 0), dd = (day(now) - day(d)) / 864e5;
    if (dd <= 0) return fmtTime(t);
    if (dd === 1) return 'Yesterday';
    return d.toLocaleDateString('en-US', d.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
  }
  const fmtDay = t => new Date(t).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  function colorOf(s) {
    try { if (s.color && typeof ORB_PAL !== 'undefined' && ORB_PAL[s.color]) return ORB_PAL[s.color].rim; } catch { }
    return (window.FAMILY_COLOR || {})[s.family] || '#9fb4d8';
  }
  const initial = s => { const m = String(s.name || '?').trim().match(/[\p{L}\p{N}]/u); return m ? m[0].toUpperCase() : '?'; };
  const avatar = (s, cls = '') => `<span class="ct-av${cls}" style="--av:${esc(colorOf(s))}"><b>${esc(initial(s))}</b></span>`;
  const lastT = s => { const l = s.log || [], t = l.length ? l[l.length - 1].t : 0; const u = s.sinceUse ?? s.sinceWrite; return Math.max(t || 0, u != null ? Date.now() - u * 1000 : 0); };
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
      const r = e.target.closest('.ct-row'); if (r) select(r.dataset.sid);
    });
    list.addEventListener('input', e => { if (on && e.target.id === 'ctQ') { query = e.target.value; renderList(); } });
    list.addEventListener('keydown', e => { if (on && e.target.id === 'ctQ' && e.key === 'Escape') { searchOpen = false; query = ''; lastListHtml = ''; renderList(); } });
    list.addEventListener('contextmenu', e => { if (!on) return; const r = e.target.closest('.ct-row'); if (r) { e.preventDefault(); openCmdMenu(r.dataset.sid, e.clientX, e.clientY); } });
  }

  // ---------- chat rooms (terminal panels) ----------
  function makeRoom(id, t) {
    const el = document.createElement('div'); el.className = 'chatroom';
    el.innerHTML = `<div class="cr-head"><span class="cr-av"></span><div class="cr-who"><div class="cr-name"></div><div class="cr-sub"></div></div>
        <span class="cr-hb" data-a="term" title="Show the terminal">${SVG.term}</span><span class="cr-hb" data-a="menu" title="Commands">${SVG.menu}</span></div>
      <div class="cr-scroll"><div class="cr-msgs"></div><div class="cr-typing" hidden></div></div>
      <button class="cr-jump" hidden title="Newest messages">${SVG.down}</button>
      <div class="cr-input"><textarea rows="1" placeholder="Enter a message" spellcheck="false"></textarea>
        <div class="cr-bar"><span class="cr-ib" data-a="plus" title="Attach files (their paths go into the message)">${SVG.plus}</span><span class="cr-ib" data-a="emo" title="Emoji">${SVG.smile}</span><span class="cr-ib" data-a="file" title="Attach files">${SVG.file}</span>
        <span class="cr-sp"></span><button class="cr-send" disabled>Send</button></div>
        <div class="cr-emo" hidden>${EMO.map(x => `<span>${x}</span>`).join('')}</div><input type="file" multiple hidden></div>`;
    const back = document.createElement('button'); back.className = 'cr-back'; back.title = 'Back to the chat room'; back.innerHTML = SVG.chat + '<span>Chat</span>';
    t.el.appendChild(el); t.el.appendChild(back);
    const R = { id, el, back, t, sid: null, keys: '', items: [], pending: [], open: new Set(), fetchAt: 0, busy: false, first: true,
      scroll: el.querySelector('.cr-scroll'), msgs: el.querySelector('.cr-msgs'), ta: el.querySelector('textarea'), send: el.querySelector('.cr-send') };
    const atBottom = () => R.scroll.scrollHeight - R.scroll.scrollTop - R.scroll.clientHeight < 40;
    R.atBottom = atBottom;
    R.stick = true;   // follow the newest message until you scroll up (only judged while the room is on screen)
    R.scroll.addEventListener('scroll', () => { if (!R.scroll.clientHeight) return; R.stick = atBottom(); el.querySelector('.cr-jump').hidden = R.stick; });
    new ResizeObserver(() => { if (R.stick && R.scroll.clientHeight) R.scroll.scrollTop = R.scroll.scrollHeight; }).observe(R.msgs);
    new ResizeObserver(() => { if (R.stick && R.scroll.clientHeight) R.scroll.scrollTop = R.scroll.scrollHeight; }).observe(R.scroll);
    el.querySelector('.cr-jump').onclick = () => { R.scroll.scrollTop = R.scroll.scrollHeight; };
    const grow = () => { R.ta.style.height = 'auto'; R.ta.style.height = Math.min(140, R.ta.scrollHeight) + 'px'; R.send.disabled = !R.ta.value.trim(); };
    R.grow = grow;
    R.ta.addEventListener('input', grow);
    R.ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); doSend(R); }
      e.stopPropagation();
    });
    R.send.onclick = () => doSend(R);
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
      else { const r = b.getBoundingClientRect(); openCmdMenu(R.sid, r.left, r.bottom + 4); }
    });
    back.onclick = () => setXterm(R, false);
    // files dropped into the room: their paths go into the message
    el.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.stopPropagation(); } });
    el.addEventListener('drop', e => { if (!e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); e.stopPropagation(); addPaths(R, [...e.dataTransfer.files]); });
    // the hidden terminal never takes the keyboard while the room covers it: typing would go to the session unseen
    const ta = t.term && t.term.textarea;
    if (ta) ta.addEventListener('focus', () => { if (roomShown(R)) setTimeout(() => R.ta.focus(), 0); });
    el.addEventListener('mousedown', () => { activeTerm = id; });
    return R;
  }
  function insert(R, s) { const a = R.ta.selectionStart ?? R.ta.value.length, b = R.ta.selectionEnd ?? a; R.ta.value = R.ta.value.slice(0, a) + s + R.ta.value.slice(b); R.ta.focus(); R.ta.selectionStart = R.ta.selectionEnd = a + s.length; R.grow(); }
  function addPaths(R, files) {
    const ps = files.map(f => { try { return window.api.pathForFile(f); } catch { return ''; } }).filter(Boolean).map(p => /\s/.test(p) ? `"${p}"` : p);
    if (ps.length) insert(R, (R.ta.value && !/\s$/.test(R.ta.value) ? ' ' : '') + ps.join(' ') + ' ');
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
    const text = R.ta.value.replace(/\s+$/, ''); if (!text.trim()) return;
    const s = sessions().find(x => x.sid === R.sid); if (!s) return toast('This session is not running');
    R.ta.value = ''; R.grow();
    const p = { id: 'p' + Date.now(), t: Date.now(), k: 'u', x: text, pending: true }; R.pending.push(p); draw(R, true);
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
    R.pending = R.pending.filter(p => !p.failed ? Date.now() - p.t < 60000 && !items.some(m => m.k === 'u' && m.t >= p.t - 5000 && m.x.trim() === p.x.trim()) : Date.now() - p.t < 30000);
    draw(R, false);
  }
  function draw(R, force) {
    const s = sessions().find(x => x.sid === R.sid); if (!s) return;
    const all = R.items.concat(R.pending), keys = all.map(m => m.id + (m.failed ? '!' : '')).join('|') + '#' + [...R.open].join(',');
    const typing = s.health === 'working';
    const ty = R.el.querySelector('.cr-typing');
    if (ty.hidden === typing) { ty.hidden = !typing; ty.innerHTML = typing ? `${avatar(s, ' sm')}<span class="cr-dots"><i></i><i></i><i></i></span>` : ''; if (typing && R.stick) R.scroll.scrollTop = R.scroll.scrollHeight; }
    if (!force && keys === R.keys) return;
    const prev = new Set(R.keys ? R.keys.split('#')[0].split('|').map(k => k.replace(/!$/, '')) : []), animate = !R.first;
    const wasBottom = R.first || R.stick, st = R.scroll.scrollTop;
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
      const long = m.x.length > 900 && !R.open.has(m.id), cut = long ? m.x.slice(0, 700).replace(/\s+\S*$/, '') + '…' : m.x;
      const body = m.k === 'a' && typeof mdToHtml === 'function' ? mdToHtml(cut) : esc(cut);
      const more = long ? `<div class="cr-more" data-open="${esc(m.id)}">See more</div>` : '';
      const time = lastOfMin && m.t ? `<span class="cr-t">${m.failed ? 'Not sent' : m.pending ? '' : esc(fmtTime(m.t))}</span>` : '';
      if (m.k === 'u') out.push(`<div class="cr-msg me${firstOfRun ? ' first' : ''}${m.pending ? ' pending' : ''}${m.failed ? ' failed' : ''}${neu}">${time}<div class="cr-bub">${body}${more}</div></div>`);
      else out.push(`<div class="cr-msg them${firstOfRun ? ' first' : ''}${neu}">${firstOfRun ? avatar(s) : '<span class="ct-av ghost"></span>'}<div class="cr-col">${firstOfRun ? `<div class="cr-from">${esc(s.name)}</div>` : ''}<div class="cr-line"><div class="cr-bub md">${body}${more}</div>${time}</div></div></div>`);
    }
    if (!all.length) out.push(`<div class="cr-empty">No messages yet. Say hello below.</div>`);
    R.msgs.innerHTML = out.join('');
    R.scroll.scrollTop = wasBottom ? R.scroll.scrollHeight : st;
    R.el.querySelector('.cr-jump').hidden = !R.scroll.clientHeight || R.atBottom();
  }
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
      const visible = roomShown(R) && (document.body.dataset.view === 'grid' || t.el.classList.contains('on'));
      if (visible) { refresh(R); draw(R, false); if (R.stick && !R.atBottom()) R.scroll.scrollTop = R.scroll.scrollHeight; if (id === activeTerm && document.hasFocus()) markSeen(s); }
    }
    for (const [id, R] of rooms) if (!terms.has(id)) { R.el.remove(); R.back.remove(); rooms.delete(id); }
  }
  function markSeen(s) { const t = lastT(s); if (!seenAt[s.sid] || seenAt[s.sid] < t) { seenAt[s.sid] = t; LS.set('chat.seen', seenAt); } }
  // clicks inside a room's messages: "See more" and folded tool runs
  document.addEventListener('click', e => {
    const o = e.target.closest('.chatroom [data-open]'); if (!o) return;
    const R = [...rooms.values()].find(r => r.el.contains(o)); if (!R) return;
    R.open.add(o.dataset.open); draw(R, true);
  });

  // ---------- switching ----------
  function set(v) {
    on = !!v; LS.set('uiTheme', on ? 'chat' : 'default');
    document.body.classList.toggle('chat-theme', on);
    lastListHtml = '';
    syncRooms();
    renderListApp();   // the list redraws in whichever look is on now (app.js renderList hands over to us while the theme is on)
    if (typeof toast === 'function') toast(on ? `Theme: ${NAME}` : 'Theme: Default');
    requestAnimationFrame(() => { try { typeof fitAll === 'function' && fitAll(); } catch { } });
  }
  const renderListApp = () => { try { window.renderList && window.renderList(); } catch { } };   // app.js's renderList (ours shadows the name here)

  window.chatTheme = {
    name: NAME,
    get on() { return on; },
    set,
    renderList,
    update() { if (on) { renderList(); } syncRooms(); },
    seen(sid) { const s = sessions().find(x => x.sid === sid); if (s && on) { markSeen(s); lastListHtml = ''; } },
  };
  wireList();
  if (on) { document.body.classList.add('chat-theme'); setTimeout(() => { renderListApp(); syncRooms(); }, 0); }
})();
