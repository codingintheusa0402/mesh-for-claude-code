// Live view of the Chrome tab a job drives (2026-11-01): connects to that Chrome's DevTools port (9222 / 9223 on this
// Mac), picks the tab (the one on the site the job works on, else the frontmost page), and streams it with Chrome's
// own screencast — frames come only when the page repaints, ≤ 6 a second, JPEG ≤ 960 px. A tab Chrome doesn't
// paint (in the background) falls back to one screenshot every 2 s. Nothing runs unless a Live panel is watching.
// Read-only: it never clicks or types into the page.
function createLiveCdp(send) {
  const watches = new Map();   // key → { ws, timer, lastSent, target }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function targets(port) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(2500) }); return (await r.json()).filter(t => t.type === 'page' && t.webSocketDebuggerUrl); } catch { return []; }
  }
  async function watch(key, port, hosts, targetId) {
    unwatch(key);
    const list = await targets(port); if (!list.length) { send(key, { err: `No Chrome is listening on port ${port}.` }); return; }
    let t = targetId && list.find(x => x.id === targetId);
    if (!t && hosts && hosts.length) for (const h of hosts) { t = list.find(x => x.url.includes(h)); if (t) break; }
    if (!t) t = list.find(x => !/^(chrome|devtools|about):/.test(x.url)) || list[0];
    const w = { lastSent: 0, frames: 0, target: t, dead: false };
    watches.set(key, w);
    send(key, { meta: { port, targetId: t.id, title: t.title, url: t.url, tabs: list.map(x => ({ id: x.id, title: x.title.slice(0, 80), url: x.url })) } });
    const ws = new WebSocket(t.webSocketDebuggerUrl); w.ws = ws; let id = 0;
    const call = (method, params = {}) => { try { ws.send(JSON.stringify({ id: ++id, method, params })); } catch { } return id; };
    const shots = new Map(); let metricsId = 0, vp = null;   // the tab's viewport, to scale the fallback stills to ≤ 960 px
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.method === 'Page.screencastFrame') {
        call('Page.screencastFrameAck', { sessionId: m.params.sessionId });
        const now = Date.now(); w.frames++;
        if (now - w.lastSent < 160) return;                       // ≤ 6 frames a second to the window
        w.lastSent = now; send(key, { frame: m.params.data, mime: 'image/jpeg' });
      } else if (m.method === 'Page.frameNavigated' && m.params.frame && !m.params.frame.parentId) {
        send(key, { meta: { url: m.params.frame.url } });
      } else if (m.id === metricsId && m.result) {
        const v = m.result.cssVisualViewport || m.result.visualViewport || m.result.layoutViewport, dv = m.result.visualViewport;
        if (v) vp = { w: v.clientWidth, h: v.clientHeight, dpr: dv && v.clientWidth ? Math.max(1, dv.clientWidth / v.clientWidth) : 2 };   // Retina: stills come out dpr× bigger
      } else if (m.id && shots.has(m.id) && m.result && m.result.data) {
        shots.delete(m.id); send(key, { frame: m.result.data, mime: 'image/jpeg' });
      }
    };
    ws.onopen = () => {
      call('Page.enable'); metricsId = call('Page.getLayoutMetrics');
      call('Page.startScreencast', { format: 'jpeg', quality: 55, maxWidth: 960, maxHeight: 960, everyNthFrame: 1 });
      // a background tab doesn't paint: then a still every 2 s
      w.timer = setInterval(() => { if (Date.now() - w.lastSent > 2500) { const sc = vp && vp.w ? Math.min(1, 960 / (vp.w * (vp.dpr || 2))) : .25;
        const i = call('Page.captureScreenshot', { format: 'jpeg', quality: 50, optimizeForSpeed: true, ...(vp ? { clip: { x: 0, y: 0, width: vp.w, height: vp.h, scale: sc } } : {}) }); shots.set(i, 1); } }, 2000);
    };
    ws.onclose = () => { if (!w.dead) send(key, { err: 'The Chrome tab closed.' }); clearInterval(w.timer); };
    ws.onerror = () => { };
  }
  function unwatch(key) {
    const w = watches.get(key); if (!w) return;
    w.dead = true; clearInterval(w.timer);
    try { w.ws && w.ws.readyState === 1 && w.ws.send(JSON.stringify({ id: 99999, method: 'Page.stopScreencast' })); } catch { }
    try { w.ws && w.ws.close(); } catch { }
    watches.delete(key);
  }
  return { watch, unwatch, targets, stopAll: () => [...watches.keys()].forEach(unwatch) };
}
module.exports = { createLiveCdp };
