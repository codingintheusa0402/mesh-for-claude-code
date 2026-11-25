// Live panel (2026-11-01, rebuilt 2026-11-25 on renderer/live-view.js, which the iPhone page shares): what a session's
// job is doing, as it happens. The main panel follows the session you select (or the busiest working one); 📌 pins
// another panel to one session. Every Live panel's title names its session, and the Window menu has ONE "Live" entry
// (a submenu once there are pinned panels). Nothing polls while no Live panel is on screen.
(function () {
  const D = window.meshDock, api = window.api && window.api.live; if (!D || !api || !window.LiveView) return;
  const panels = new Map();        // panel id → { ctl, pinnedSid }
  const sessions = () => (typeof snap !== 'undefined' && snap.sessions) || [];
  const followSid = () => {
    const sel = typeof selected !== 'undefined' ? selected : null;
    if (sel && sessions().some(s => s.sid === sel)) return sel;
    const w = sessions().filter(s => s.health === 'working' && !s.onPeer).sort((a, b) => (b.tps || 0) - (a.tps || 0))[0];
    return w ? w.sid : null;
  };
  const isOn = (id, el) => el.isConnected && D.isShown(id) && !el.classList.contains('dk-off') && el.offsetParent !== null && document.visibilityState === 'visible';

  // the window an MCP drives (Blender …), via screen capture
  const win = {
    async start(P, box) {
      if (P.stream || P.starting || !box) return; const mcp = window.api.mcp; if (!mcp) return;
      P.starting = true;
      try {
        const r = await mcp.sources(false);
        if (r.status !== 'granted') {
          box.innerHTML = `<div class="lv-perm">To see the app this job drives, allow screen recording for this app.<br><button class="lv-allow">Allow screen recording</button><div class="lv-howto">System Settings → Privacy &amp; Security → Screen &amp; System Audio Recording → turn on this app, then quit and reopen it.</div></div>`;
          box.querySelector('.lv-allow').onclick = async () => { await mcp.sources(true); mcp.screenSettings(); };
          return;
        }
        const src = (r.sources || []).find(s => /^Blender$/.test(s.owner)) || null;
        if (!src) { box.innerHTML = '<div class="lv-wait">The app this job drives isn\'t open on this Mac.</div>'; return; }
        if (!(await mcp.pick(src.id))) return;
        const stream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: { frameRate: { ideal: 6, max: 8 }, width: { max: 1280 }, height: { max: 1280 } } });
        if (P.view !== 'window') { stream.getTracks().forEach(t => t.stop()); return; }
        P.stream = stream; box.innerHTML = '<video muted playsinline></video>'; const v = box.querySelector('video'); v.srcObject = stream; v.play().catch(() => { });
      } catch { win.stop(P); } finally { P.starting = false; }
    },
    stop(P) { if (P.stream) { P.stream.getTracks().forEach(t => t.stop()); P.stream = null; } },
  };

  function make(id, pinnedSid) {
    const el = document.createElement('section'); el.className = 'live-panel';
    const box = document.createElement('div'); box.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column'; el.appendChild(box);
    const ctl = window.LiveView.create(box, api, {
      sid: () => pinnedSid || followSid(),
      session: sid => sessions().find(s => s.sid === sid),
      visible: () => isOn(id, el),
      window: win,
      title: (P, s) => D.setTitle(id, `Live · ${s ? s.name : 'no session'}${pinnedSid ? ' (pinned)' : ''}`),
    });
    if (!pinnedSid) {
      const pin = document.createElement('button'); pin.className = 'lv-pin'; pin.textContent = '📌'; pin.title = 'Pin a Live panel to this session (watch several jobs at once)';
      pin.onclick = () => { if (ctl.P.sid) openPinned(ctl.P.sid); }; el.appendChild(pin);
    }
    panels.set(id, { ctl, pinnedSid, el });
    return el;
  }
  function openPinned(sid) {
    const id = 'live:' + sid, s = sessions().find(x => x.sid === sid);
    if (!panels.has(id)) D.register(id, { title: `Live · ${s ? s.name : 'session'} (pinned)`, el: make(id, sid), spot: { edge: 'right', size: .3, group: 'live' } });
    D.show(id); panels.get(id).ctl.tick();
  }
  const kick = (ms = 250) => { for (const [, x] of panels) { clearTimeout(x.k); x.k = setTimeout(() => x.ctl.tick(), ms); } };

  // the main Live panel follows your selection; it pops up by itself when a job starts doing visible work
  D.autoHide('live', true);
  D.register('live', { title: 'Live', el: make('live', null), spot: { edge: 'right', size: .32, group: 'live' } });
  let lastSel = null;
  setInterval(() => { const s = typeof selected !== 'undefined' ? selected : null; if (s !== lastSel) { lastSel = s; for (const [, x] of panels) if (!x.pinnedSid) x.ctl.tick(); } }, 700);   // a cheap compare
  async function watchForWork() {
    if (document.visibilityState === 'visible' && !D.isShown('live')) {
      const sid = followSid(), s = sid && sessions().find(x => x.sid === sid);
      if (s && s.health === 'working') { const j = await api.job(sid, {}); if (j && ['browser', 'doc', 'window'].includes(j.focus)) D.autoHide('live', false); }
    }
    setTimeout(watchForWork, 15000);
  }
  setTimeout(watchForWork, 4000);
  D.onChange(() => kick());
  document.addEventListener('visibilitychange', () => kick(50));
  window.liveWatch = sid => openPinned(sid);     // for a "Watch live" command elsewhere
})();
