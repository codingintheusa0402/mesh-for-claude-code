// Orbit view: rest the pointer on a session's bubble (~0.6 s without moving) and its picture pops up above the bubble
// (renderer/avatars.js: the picked picture, GIFs animated, else the initial). It follows the bubble while shown and fades
// out as soon as the pointer moves off. Pure DOM; nothing runs while the pointer is outside the orbit canvas.
(function () {
  const canvas = document.getElementById('mesh');
  if (!canvas || typeof viz === 'undefined' || !window.meshAvatars) return;
  const REST = 600, SIZE = 132;
  const pop = document.createElement('div'); pop.className = 'orbit-av'; document.body.appendChild(pop);
  let movedAt = 0, inside = false, held = false, shownSid = null, raf = 0, timer = 0;
  const node = sid => viz.nodes && viz.nodes.get(sid);
  const session = sid => (typeof snap !== 'undefined' && snap.sessions || []).find(s => s.sid === sid);
  function place() {
    const n = node(shownSid); if (!n || !inside) return hide();
    const onSun = shownSid === viz.sunSid && viz.hub, r = canvas.getBoundingClientRect(), c = viz.cam;
    const R = (onSun ? viz.motherRadius() : viz.nodeRadius(n) * (n.gscale ?? 1)) * c.s, P = onSun ? viz.hub : n;
    const x = r.left + c.tx + P.x * c.s, y = r.top + c.ty + P.y * c.s;
    pop.style.transform = `translate(${Math.round(Math.min(Math.max(4, x - SIZE / 2), innerWidth - SIZE - 4))}px, ${Math.round(Math.max(4, y - R - SIZE - 14))}px)`;
    raf = requestAnimationFrame(place);
  }
  function show(sid) {
    const s = session(sid); if (!s) return;
    shownSid = sid;
    const src = window.meshAvatars.src(s.name, 256);
    pop.innerHTML = (src ? `<img alt="" src="${src}">` : window.meshAvatars.html(s, { cls: 'orbit-av-letter', size: 256 })) + `<span class="orbit-av-name">${s.name.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])}</span>`;
    cancelAnimationFrame(raf); place(); pop.classList.add('on');
  }
  function hide() { clearTimeout(timer); if (!shownSid) return; shownSid = null; pop.classList.remove('on'); cancelAnimationFrame(raf); }
  function check() {
    clearTimeout(timer); if (!inside || held) return;
    // the mother star is the sun session (the one running this app, sun.js): its picture pops up over the star
    const h = viz.hover === 'hub' ? viz.sunSid : viz.hover, sid = h && node(h) ? h : null;
    if (shownSid && sid !== shownSid) hide();
    if (sid && !shownSid) { const wait = REST - (performance.now() - movedAt); if (wait <= 0) show(sid); else { timer = setTimeout(check, wait + 10); return; } }
    if (shownSid) timer = setTimeout(check, 200);
  }
  canvas.addEventListener('mousemove', () => { movedAt = performance.now(); inside = true; held = false; setTimeout(check, 0); });
  canvas.addEventListener('mouseleave', () => { inside = false; clearTimeout(timer); hide(); });
  canvas.addEventListener('mousedown', () => { held = true; hide(); });  // stays hidden until the pointer moves again
})();
