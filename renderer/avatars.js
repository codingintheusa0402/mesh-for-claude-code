// Session pictures in the window, its detached rooms and the iPhone page (2026-11-26; main side: avatars.js).
// snap.avatars = { "<session name>": { file, t, v } } — v is the version of the cropped copy on the machine that serves
// this page ('' while it is being made). A session without a picture keeps its initial-letter avatar.
//   meshAvatars.src(name, size)   the picture's URL (meshav:// in the app, /api/avatar?t=… on the phone) or null
//   meshAvatars.html(s, opt)      a round avatar: the picture, or the initial on the session's colour
//   meshAvatars.pick(s)           (app only) the picker: every picture in the folder, Letter, Sync now, Open in Drive
// Any element with data-avpick="<sid>" opens the picker on click (cards, chat list rows, room headers).
(function () {
  const APP = !!(window.api && window.api.avatars);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const snapNow = () => { try { return snap; } catch { return null; } };   // app.js / chatwin.js / phone.js global
  const tok = () => { try { return TOKEN; } catch { return ''; } };
  const map = () => { const s = snapNow(); return (s && s.avatars) || {}; };
  const url = (file, v, size) => APP ? `meshav://img/${encodeURIComponent(file)}?s=${size}&v=${v}`
    : `/api/avatar?f=${encodeURIComponent(file)}&s=${size}&v=${v}&t=${encodeURIComponent(tok())}`;
  // A list, board or room rebuilt with innerHTML makes new <img>s and Chromium starts each new one at frame 1, so a list that
  // re-renders on every status change kept restarting its GIFs. When a rebuild drops an animated picture and adds the same
  // URL back (same mutation batch, before the next paint), the old <img> goes back in place of the new one and keeps playing.
  const AV = n => n.nodeType === 1 ? (n.tagName === 'IMG' ? [n] : n.firstElementChild ? n.getElementsByTagName('img') : []) : [];
  const anim = i => /^meshav:/.test(i.src) && /\.gif(\?|%3F|$)/i.test(decodeURIComponent(i.src.split('?')[0])) || i.dataset.anim === '1';
  const mo = new MutationObserver(recs => {
    let pool = null;
    for (const r of recs) for (const n of r.removedNodes) for (const i of AV(n)) if (!i.isConnected && anim(i)) { (pool ||= new Map()); const l = pool.get(i.src); l ? l.push(i) : pool.set(i.src, [i]); }
    if (!pool) return;
    for (const r of recs) for (const n of r.addedNodes) for (const i of [...AV(n)]) {
      if (!i.isConnected) continue; const l = pool.get(i.src), old = l && l.shift(); if (!old) continue;
      old.className = i.className; if (i.title) old.title = i.title; i.replaceWith(old);
    }
    mo.takeRecords();   // our own swaps: not a rebuild, or the two <img>s would swap back and forth forever
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  function src(name, size = 256) { const e = map()[name]; if (!(e && e.file && e.v)) return null; return url(e.file, e.v, size); }
  const initial = s => { const m = String((s && s.name) || '?').trim().match(/[\p{L}\p{N}]/u); return m ? m[0].toUpperCase() : '?'; };
  const colorOf = s => { try { if (s.color && typeof ORB_PAL !== 'undefined' && ORB_PAL[s.color]) return ORB_PAL[s.color].rim; } catch { } return ((typeof FAMILY_COLOR !== 'undefined' && FAMILY_COLOR) || window.FAMILY_COLOR || {})[s && s.family] || '#9fb4d8'; };
  function html(s, { cls = '', click = false, size = 256, letter = true } = {}) {
    if (!s) return '';
    const pic = src(s.name, size);
    if (!pic && !letter) return '';
    const pick = click && APP ? ` data-avpick="${esc(s.sid)}" title="Change picture"` : '';
    return `<span class="mav${cls ? ' ' + cls : ''}${pic ? ' pic' : ''}" style="--av:${esc(colorOf(s))}"${pick}>${pic ? `<img src="${esc(pic)}" alt="" draggable="false">` : `<b>${esc(initial(s))}</b>`}</span>`;
  }

  // ---------- styles (both themes; the chat theme's own avatars are styled in chat-theme.css) ----------
  const css = `
.mav { flex: none; display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; overflow: hidden; vertical-align: middle;
  background: linear-gradient(150deg, color-mix(in srgb, var(--av) 70%, #fff) 0%, var(--av) 100%); }
.mav b { font: 700 12px/1 -apple-system, system-ui, sans-serif; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.2); }
.mav.pic { background: #222; }
.mav img, .ct-av.pic img { width: 100%; height: 100%; object-fit: cover; display: block; border-radius: inherit; }
[data-avpick] { cursor: pointer; }
[data-avpick]:hover { filter: brightness(1.08); box-shadow: 0 0 0 2px rgba(120,160,255,.55); }
.avp-back { position: fixed; inset: 0; z-index: 9000; background: rgba(0,0,0,.45); display: grid; place-items: center; }
.avp { --bg: #1b1d24; --fg: #e8ebf2; --dim: #9aa3b5; --line: rgba(255,255,255,.09); --tile: #262a34; --on: #6c8cff;
  width: min(640px, calc(100vw - 32px)); max-height: min(620px, calc(100vh - 48px)); display: flex; flex-direction: column; background: var(--bg); color: var(--fg);
  border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,.45); font: 13px -apple-system, system-ui, sans-serif; overflow: hidden; }
body.chat-theme:not(.ct-dark) .avp { --bg: #fff; --fg: #1d1d1f; --dim: #6e7480; --line: rgba(0,0,0,.08); --tile: #f1f3f6; --on: #3a6df0; }
.avp-h { display: flex; align-items: center; gap: 12px; padding: 16px 18px 12px; border-bottom: 1px solid var(--line); }
.avp-h .mav { width: 44px; height: 44px; } .avp-h .mav b { font-size: 19px; }
.avp-t { flex: 1; min-width: 0; } .avp-t b { display: block; font-size: 15px; } .avp-t span { color: var(--dim); font-size: 12px; }
.avp-x { border: 0; background: none; color: var(--dim); font-size: 20px; cursor: pointer; padding: 4px 8px; }
.avp-g { flex: 1; overflow: auto; padding: 14px 18px; display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 12px; align-content: start; }
.avp-i { position: relative; aspect-ratio: 1; border-radius: 22%; background: var(--tile); overflow: hidden; cursor: pointer; display: grid; place-items: center;
  outline: 2px solid transparent; outline-offset: 2px; transition: transform .12s ease; }
.avp-i:hover { transform: scale(1.04); } .avp-i.on { outline-color: var(--on); }
.avp-i img { width: 100%; height: 100%; object-fit: cover; display: block; }
.avp-i .mav { width: 64%; height: 64%; } .avp-i .mav b { font-size: 26px; }
.avp-i em { position: absolute; left: 0; right: 0; bottom: 0; padding: 3px 6px; font: 10px/1.3 -apple-system, system-ui, sans-serif; font-style: normal; color: #fff;
  background: linear-gradient(transparent, rgba(0,0,0,.55)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; }
.avp-i .spin { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--dim); border-top-color: transparent; animation: avpSpin .9s linear infinite; }
@keyframes avpSpin { to { transform: rotate(360deg); } }
.avp-empty { grid-column: 1 / -1; color: var(--dim); line-height: 1.5; padding: 8px 2px; }
.avp-f { display: flex; align-items: center; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--line); }
.avp-f .st { flex: 1; min-width: 0; color: var(--dim); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.avp-f button { border: 1px solid var(--line); background: var(--tile); color: var(--fg); border-radius: 8px; padding: 6px 11px; font: 12px -apple-system, system-ui, sans-serif; cursor: pointer; }
.avp-f button.pri { background: var(--on); border-color: var(--on); color: #fff; } .avp-f button:disabled { opacity: .55; cursor: default; }
`;
  const st = document.createElement('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st);

  // ---------- the picker (app only) ----------
  let P = null;   // { s, el, data }
  const agoTxt = t => { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  function draw() {
    if (!P) return;
    const d = P.data || { files: [] }, cur = (map()[P.s.name] || {}).file || null, sy = d.sync;
    const tiles = [`<div class="avp-i${cur ? '' : ' on'}" data-f="" title="The initial letter"><span class="mav" style="--av:${esc(colorOf(P.s))}"><b>${esc(initial(P.s))}</b></span><em>Letter</em></div>`]
      .concat(d.files.map(x => `<div class="avp-i${x.file === cur ? ' on' : ''}" data-f="${esc(x.file)}" title="${esc(x.file)}">${x.v ? `<img src="${esc(tileUrl(x))}" alt="" loading="lazy" draggable="false">` : '<span class="spin"></span>'}<em>${esc(x.file.replace(/\.[^.]+$/, ''))}</em></div>`));
    const empty = d.files.length ? '' : `<div class="avp-empty">No pictures yet. Put pictures or GIFs into ${d.source ? `<b>${esc(d.source)}</b>` : 'the pictures folder'}${d.canSync ? '; they arrive here every 15 minutes, or now with Sync now' : ''}. Wide GIFs are cropped to their centre.</div>`;
    const status = P.syncing ? 'Syncing…' : P.msg ? P.msg : sy ? (sy.ok === false ? `Sync failed ${agoTxt(sy.at)}: ${sy.error || ''}` : `${d.files.length} picture${d.files.length === 1 ? '' : 's'} · synced ${agoTxt(sy.at)}`) : `${d.files.length} picture${d.files.length === 1 ? '' : 's'}`;
    P.el.querySelector('.avp-g').innerHTML = tiles.join('') + empty;
    P.el.querySelector('.avp-h .mav-slot').innerHTML = html(P.s, { size: 512 });
    P.el.querySelector('.st').textContent = status;
    const sb = P.el.querySelector('[data-sync]'); sb.hidden = !d.canSync; sb.disabled = !!P.syncing;
    P.el.querySelector('[data-drive]').hidden = !d.sourceUrl;
  }
  const tileUrl = x => url(x.file, x.v, 256);
  async function load() { if (!P) return; try { P.data = await window.api.avatars.list(); } catch { } draw(); }
  function close() { if (P) { P.el.remove(); P = null; } }
  function pick(s) {
    if (!APP || !s) return;
    close();
    const el = document.createElement('div'); el.className = 'avp-back';
    el.innerHTML = `<div class="avp" role="dialog" aria-label="Session picture"><div class="avp-h"><span class="mav-slot"></span><div class="avp-t"><b>${esc(s.name)}</b><span>Picture for this session name; it stays through handoffs and refreshes, on both Macs.</span></div><button class="avp-x" title="Close">×</button></div>
      <div class="avp-g"></div><div class="avp-f"><span class="st"></span><button data-folder>Show folder</button><button data-drive>Open in Drive</button><button class="pri" data-sync>Sync now</button></div></div>`;
    document.body.appendChild(el);
    P = { s, el, data: null };
    el.addEventListener('click', async e => {
      if (e.target === el || e.target.closest('.avp-x')) return close();
      const t = e.target.closest('.avp-i');
      if (t) { const f = t.dataset.f || null, r = await window.api.avatars.set(s.name, f); if (r && r.ok === false) { P.msg = r.err; return draw(); }
        const sn = snapNow(); if (sn) { sn.avatars = { ...(sn.avatars || {}) }; const old = ((P.data || {}).files || []).find(x => x.file === f); sn.avatars[s.name] = { file: f, t: Date.now(), v: old && old.v || '' }; }
        try { window.renderBoard && window.renderBoard(); window.renderTabs && window.renderTabs(); window.chatTheme && window.chatTheme.update(); } catch { }
        return close(); }
      if (e.target.closest('[data-sync]')) { P.syncing = true; P.msg = ''; draw(); const r = await window.api.avatars.sync(); if (!P) return; P.syncing = false; P.msg = r.ok ? '' : 'Sync failed: ' + (r.err || ''); return load(); }
      if (e.target.closest('[data-drive]')) return window.api.avatars.openSource(P.data && P.data.sourceUrl);
      if (e.target.closest('[data-folder]')) return window.api.avatars.reveal();
    });
    draw(); load();
  }
  if (APP) {
    window.api.avatars.onChanged(() => { if (P) load(); });
    addEventListener('keydown', e => { if (P && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }, true);
    // a click on a session's avatar opens the picker instead of selecting the card / row
    addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('[data-avpick]'); if (!a) return;
      e.preventDefault(); e.stopPropagation();
      const sn = snapNow(), s = sn && (sn.sessions || []).find(x => x.sid === a.dataset.avpick); if (s) pick(s);
    }, true);
  }
  window.meshAvatars = { src, html, pick, url, close };
})();
