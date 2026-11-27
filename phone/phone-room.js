// The chat room on the phone (2026-11-27): with the chat theme on, the open session's panel shows its transcript the way
// the desktop chat theme does (renderer/chat-theme.js): your prompts on the right in yellow bubbles, replies on the left
// with the session's picture and name, tool calls as small grey centred lines (a long run folded: "+ N more tool calls"),
// times, a "…" bubble while the session works. Markdown through md.js (mdToHtml).
// Data: GET /api/chat (the session's transcript tail; a session on the other Mac is forwarded there), polled while the
// room is on screen: every 2 s while the session works, every 6 s when idle, not at all while the page is hidden.
// Only the rows that changed are replaced, so a long-press selection survives the polling. The room follows the newest
// message unless you scrolled up. A sent message shows as a pending bubble (with its pictures) until the transcript has
// it, matched loosely (spacing, file paths and [Image #n] tags ignored), or for a minute.
// Uses phone.js globals at call time: api, esc, AV, snap, TOKEN.
const Room = (() => {
  const KEY = 'mesh.roomView';               // 'chat' | 'term', per device
  const pref = () => { try { return localStorage.getItem(KEY) === 'term' ? 'term' : 'chat'; } catch { return 'chat'; } };
  const setPref = v => { try { localStorage.setItem(KEY, v); } catch { } };
  const themeOn = () => document.documentElement.classList.contains('ct');
  const hasTranscript = s => !!s && s.kind !== 'hermes' && s.engine !== 'hermes';
  // the room replaces the terminal when the chat theme is on and this phone did not pick the terminal
  const wanted = s => themeOn() && hasTranscript(s) && pref() === 'chat';

  let R = null;                               // the mounted room
  const media = new Map();                    // sid|key → { url, w, h }
  const fmtTime = t => new Date(t).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  const fmtDay = t => new Date(t).toLocaleDateString('ko-KR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const sess = () => R && (snap.sessions || []).find(x => x.sid === R.sid);
  const atBottom = () => R.scroll.scrollHeight - R.scroll.scrollTop - R.scroll.clientHeight < 40;
  const toBottom = () => { if (R) R.scroll.scrollTop = R.scroll.scrollHeight; };

  function mount(host, s) {
    unmount();
    host.innerHTML = `<div class="cr-scroll"><div class="cr-msgs"></div><div class="cr-typing" hidden></div></div><button class="cr-jump" hidden aria-label="Newest messages"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5l6 6 6-6"/></svg></button>`;
    R = { sid: s.sid, host, items: [], pending: (mount.keep && mount.keep.sid === s.sid) ? mount.keep.pending : [], open: new Set(), stick: true, first: true,
      busy: false, timer: 0, health: s.health, scroll: host.querySelector('.cr-scroll'), msgs: host.querySelector('.cr-msgs'), jump: host.querySelector('.cr-jump') };
    mount.keep = null;
    const me = R;
    // only your own scrolling lets go of the newest message; layout changes keep the room following it
    let userAt = 0; const touched = () => { userAt = performance.now(); };
    for (const ev of ['touchstart', 'touchmove', 'wheel']) R.scroll.addEventListener(ev, touched, { passive: true });
    R.scroll.addEventListener('scroll', () => {
      if (!me.scroll.clientHeight) return;
      if (atBottomOf(me)) me.stick = true; else if (performance.now() - userAt < 900) me.stick = false; else if (me.stick) me.scroll.scrollTop = me.scroll.scrollHeight;
      me.jump.hidden = me.stick || atBottomOf(me);
    }, { passive: true });
    if (window.ResizeObserver) { me.ro = new ResizeObserver(() => { if (me.stick && me.scroll.clientHeight) me.scroll.scrollTop = me.scroll.scrollHeight; }); me.ro.observe(me.msgs); me.ro.observe(me.scroll); }
    R.jump.onclick = () => { me.stick = true; me.scroll.scrollTop = me.scroll.scrollHeight; };
    R.msgs.addEventListener('click', e => {
      const o = e.target.closest('[data-open]'); if (o) { me.open.add(o.dataset.open); draw(); return; }
      const p = e.target.closest('img.cr-pic'); if (p && p.src) viewer(p);
    });
    draw(); refresh(true);
  }
  const atBottomOf = r => r.scroll.scrollHeight - r.scroll.scrollTop - r.scroll.clientHeight < 40;
  function unmount() {
    if (!R) return;
    clearTimeout(R.timer); if (R.ro) R.ro.disconnect();
    if (R.pending.length) mount.keep = { sid: R.sid, pending: R.pending };   // a redraw of the pane keeps what is on its way
    R = null;
  }
  const mounted = () => !!(R && R.host.isConnected);

  function schedule() {
    if (!R) return; clearTimeout(R.timer);
    const s = sess(), ms = document.hidden ? 4000 : s && s.health === 'working' ? 2000 : 6000;
    R.timer = setTimeout(() => refresh(), ms);
  }
  async function refresh(force) {
    if (!mounted()) { unmount(); return; }
    if (document.hidden || R.busy || (typeof view === 'string' && view !== 'split')) return schedule();   // Grid / away: no fetching
    const s = sess(); if (!s) return schedule();
    const me = R; me.busy = true;
    let items = null;
    try { const r = await api('/api/chat?sid=' + encodeURIComponent(s.sid) + '&n=150'); if (Array.isArray(r)) items = r; } catch { }
    me.busy = false;
    if (R !== me) return;
    if (!items || !items.length) items = (s.log || []).map((e, i) => ({ id: 'l' + i + ':' + e.t, t: e.t, k: e.kind === 'you' ? 'u' : e.kind === 'claude' ? 'a' : 'tool', x: e.text }));
    me.items = items;
    // compared loosely: the terminal can change spacing and adds the files' paths or [Image #n] tags
    const norm = x => String(x || '').replace(/\[Image #\d+\]/g, ' ').replace(/"?\/\S+"?/g, ' ').replace(/\s+/g, ' ').trim();
    const same = (m, p) => { const a = norm(m.x), b = norm(p.x); return !b ? true : a === b || a.startsWith(b); };
    me.pending = me.pending.filter(p => Date.now() - p.t < 60000 && !items.some(m => m.k === 'u' && m.t >= p.t - 30000 && same(m, p)));
    draw(); schedule();
  }
  // a snapshot arrived (phone.js renderSplit): the typing bubble, and a fresh look when the session starts or stops working
  function update(s) {
    if (!mounted() || s.sid !== R.sid) return;
    const was = R.health; R.health = s.health; typing(s);
    if ((was === 'working') !== (s.health === 'working')) { clearTimeout(R.timer); R.timer = setTimeout(() => refresh(), 300); }
  }
  function typing(s) {
    const ty = R.host.querySelector('.cr-typing'), on = s.health === 'working';
    if (ty.hidden !== on) return;
    ty.hidden = !on; ty.innerHTML = on ? `${AV(s, 'rav sm')}<span class="cr-dots"><i></i><i></i><i></i></span>` : '';
    if (on && R.stick) toBottom();
  }
  // something you just sent: shown at once, until the transcript has it. atts: [{ name, url (blob, pictures), img }]
  function pending(sid, text, atts) {
    const p = { id: 'p' + Date.now() + Math.random().toString(36).slice(2, 6), t: Date.now(), k: 'u', x: String(text || '').trim(), pending: true,
      pimgs: (atts || []).filter(a => a.img && a.url).map(a => a.url), files: (atts || []).filter(a => !a.img).map(a => ({ name: a.name, size: a.size })) };
    if (!p.x && !p.pimgs.length && !p.files.length) return;
    if (mounted() && R.sid === sid) { R.pending.push(p); R.stick = true; draw(); toBottom(); clearTimeout(R.timer); R.timer = setTimeout(() => refresh(), 900); }
  }

  // one chat item → its rows (the text, the pictures, each file), like the messenger
  function parts(list) {
    const out = [];
    for (const m of list) {
      if (m.k === 'tool' || (!m.imgs && !m.files && !m.pimgs)) { out.push(m); continue; }
      if (m.x && m.x.trim()) out.push({ ...m, imgs: null, files: null, pimgs: null });
      if ((m.imgs && m.imgs.length) || (m.pimgs && m.pimgs.length)) out.push({ ...m, id: m.id + '#i', part: 'img', x: '' });
      for (const [i, f] of (m.files || []).entries()) out.push({ ...m, id: m.id + '#f' + i, part: 'file', f, x: '' });
    }
    return out;
  }
  const fmtSize = n => n == null || n < 0 ? '' : n < 1024 ? n + 'B' : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + 'KB' : (n / 1048576).toFixed(1) + 'MB';
  function pics(s, m) {
    if (m.pimgs) return `<div class="cr-pics${m.pimgs.length > 1 ? ' grid' : ' one'}">${m.pimgs.map(u => `<img class="cr-pic" alt="" src="${esc(u)}">`).join('')}</div>`;
    return `<div class="cr-pics${m.imgs.length > 1 ? ' grid' : ' one'}">${m.imgs.map(x => { const r = media.get(s.sid + '|' + x.key);
      return `<img class="cr-pic" alt="" data-key="${esc(x.key)}"${r ? ` src="${r.url}"` : ''}>`; }).join('')}</div>`;
  }
  function draw() {
    if (!R) return; const s = sess(); if (!s) return;
    typing(s);
    const all = parts(R.items.concat(R.pending)), blocks = [];
    let lastDay = '';
    for (let i = 0; i < all.length; i++) {
      const m = all[i], nx = all[i + 1], pv = all[i - 1];
      const day = m.t ? new Date(m.t).toDateString() : lastDay;
      if (day !== lastDay && m.t) { blocks.push(['d' + day, `<div class="cr-day"><span>${esc(fmtDay(m.t))}</span></div>`]); lastDay = day; }
      if (m.k === 'tool') {
        let j = i; while (all[j + 1] && all[j + 1].k === 'tool') j++;
        const run = all.slice(i, j + 1), key = run[0].id, open = R.open.has(key) || run.length <= 4, show = open ? run : run.slice(0, 3);
        for (const x of show) blocks.push(['t' + x.id, `<div class="cr-sys"><span>${esc(x.x)}</span></div>`]);
        if (!open) blocks.push(['m' + key, `<div class="cr-sys more" data-open="${esc(key)}"><span>+ ${run.length - 3} more tool calls</span></div>`]);
        i = j; continue;
      }
      const sameMin = (a, b) => a && b && a.k === b.k && Math.floor(a.t / 6e4) === Math.floor(b.t / 6e4);
      const first = !(pv && pv.k === m.k && new Date(pv.t).toDateString() === day), lastOfMin = !sameMin(m, nx);
      const time = m.pending ? (lastOfMin ? `<span class="cr-t"><b class="cr-rc" title="Not in the transcript yet">1</b></span>` : '') : lastOfMin && m.t ? `<span class="cr-t">${esc(fmtTime(m.t))}</span>` : '';
      let inner, kind = '';
      if (m.part === 'img') { inner = pics(s, m); kind = ' pic'; }
      else if (m.part === 'file') inner = `<div class="cr-file"><b>${esc(m.f.name || String(m.f.p || '').split('/').pop())}</b><small>${esc(fmtSize(m.f.size))}</small></div>`;
      else {
        const long = m.x.length > 900 && !R.open.has(m.id), cut = long ? m.x.slice(0, 700).replace(/\s+\S*$/, '') + '…' : m.x;
        const body = m.k === 'a' && typeof mdToHtml === 'function' ? mdToHtml(cut) : esc(cut);
        inner = `<div class="cr-bub${m.k === 'a' ? ' md' : ''}">${body}${long ? `<div class="cr-more" data-open="${esc(m.id)}">See more</div>` : ''}</div>`;
      }
      const cls = `${first ? ' first' : ''}${m.pending ? ' pending' : ''}${kind}`;
      blocks.push(['x' + m.id, m.k === 'u' ? `<div class="cr-msg me${cls}">${time}${inner}</div>`
        : `<div class="cr-msg them${cls}">${first ? AV(s, 'rav') : '<span class="rav ghost"></span>'}<div class="cr-col">${first ? `<div class="cr-from">${esc(s.name)}</div>` : ''}<div class="cr-line">${inner}${time}</div></div></div>`]);
    }
    if (!all.length) blocks.push(['empty', `<div class="cr-empty">No messages yet.</div>`]);
    // only the rows that changed are replaced (a selection or a picture in an unchanged row stays put)
    const wasBottom = R.first || R.stick, st = R.scroll.scrollTop, byKey = new Map([...R.msgs.children].map(c => [c._k, c]));
    const make = (k, h) => { const t = document.createElement('template'); t.innerHTML = h; const n = t.content.firstElementChild; n._k = k; n._h = h; return n; };
    let prev = null;
    for (const [k, h] of blocks) {
      let n = byKey.get(k); byKey.delete(k);
      if (!n || n._h !== h) { const f = make(k, h); if (n) n.replaceWith(f); n = f; }
      const at = prev ? prev.nextSibling : R.msgs.firstChild; if (n !== at) R.msgs.insertBefore(n, at); prev = n;
    }
    for (const c of byKey.values()) c.remove();
    R.first = false;
    loadPics(s);
    R.scroll.scrollTop = wasBottom ? R.scroll.scrollHeight : st;
    R.jump.hidden = !R.scroll.clientHeight || atBottom();
  }
  function loadPics(s) {
    for (const img of R.msgs.querySelectorAll('img.cr-pic[data-key]:not([src])')) {
      const k = img.dataset.key; if (img._asked) continue; img._asked = 1;
      api('/api/chat-media?sid=' + encodeURIComponent(s.sid) + '&key=' + encodeURIComponent(k)).then(r => {
        if (!r || !r.url) { img.classList.add('broken'); return; }
        media.set(s.sid + '|' + k, r); img.src = r.url;
      }).catch(() => img.classList.add('broken'));
    }
  }
  // a picture full screen: the thumbnail at once, the full one when it arrives; tap closes
  function viewer(img) {
    const v = document.createElement('div'); v.className = 'cr-viewer'; v.innerHTML = `<img alt="" src="${esc(img.src)}">`;
    document.body.appendChild(v); v.onclick = () => v.remove();
    const k = img.dataset.key, s = sess();
    if (k && s) api('/api/chat-media?sid=' + encodeURIComponent(s.sid) + '&key=' + encodeURIComponent(k) + '&full=1').then(r => { if (r && r.url && v.isConnected) v.querySelector('img').src = r.url; }).catch(() => { });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && mounted()) refresh(); });
  return { wanted, pref, setPref, themeOn, hasTranscript, mount, unmount, mounted, update, pending, pin: () => { if (R) { R.stick = true; toBottom(); } } };
})();
