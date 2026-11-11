// Moving and resizing the mesh's objects (2026-10-27).
//   Shift + scroll over an object resizes it (mouse wheel or trackpad; a "Black hole 130%" tip shows under the
//   pointer): the mother star (up to 300%), any session bubble (each its own size), the probe, the black hole, the Endurance —
//   each within limits that keep it readable and keep the layout sane (the star can't swallow the orbit, nothing gets
//   too small to grab). Over empty space shift + scroll still zooms the view.
//   Drag the black hole or the Endurance to move it anywhere on the map (⌘-drag turns / tilts it instead, like ⌘-drag
//   tilts a bubble's orbit). Both live in the orbit plane, so spinning / tilting the system carries them round with it.
//   Sizes and spots are kept in localStorage; Window ▸ Reset sizes & positions clears them.
// Loaded after endurance.js (also on the iPhone, where touch-drag moves them; there is no shift + scroll there).

const SIZE_LIM = { hub: [.6, 3], bubble: [.5, 2], probe: [.5, 2.2], bh: [.5, 3], end: [.5, 2.2] };
const SIZE_NAME = { hub: 'Mother star', probe: 'Probe', bh: 'Black hole', end: 'Endurance' };
const LAYOUT_KEY = 'mesh.layout';

Object.assign(Mesh.prototype, {
  layout() {
    if (!this.lay) { try { this.lay = JSON.parse(localStorage.getItem(LAYOUT_KEY)) || {}; } catch { this.lay = {}; } this.lay.size = this.lay.size || {}; this.lay.pos = this.lay.pos || {}; }
    return this.lay;
  },
  saveLayout() { clearTimeout(this.layT); this.layT = setTimeout(() => { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.lay)); } catch { } }, 300); },
  resetLayout() { this.lay = { size: {}, pos: {} }; try { localStorage.removeItem(LAYOUT_KEY); } catch { } },
  // size multiplier: 'hub' | 'probe' | 'bh' | 'end' | a session id
  sizeOf(k) { return this.layout().size[k] || 1; },
  // a moved object's spot (world coords; kept relative to the window so a resize keeps it in the same place)
  posOf(k) { const p = this.layout().pos[k]; return p ? { x: p.x * this.w, y: p.y * this.h } : null; },

  // what's under the pointer that can be resized
  sizeTarget(e) {
    const p = this.toWorld(e);
    if (this.hitProbe && this.hitProbe(p)) return 'probe';
    const h = this.hit(e);
    if (h === 'hub') return 'hub';
    if (h && !h.startsWith('grp:')) return h;
    const o = this.objHit && this.objHit(p);
    return o || null;
  },
  // shift + scroll: grow / shrink the object under the pointer; false when there's nothing there (the view zooms)
  wheelResize(e) {
    if (!e.shiftKey || this.compact) return false;
    const k = this.sizeTarget(e); if (!k) return false;
    e.preventDefault();
    const d = e.deltaY || e.deltaX;                                   // macOS turns shift + wheel into a sideways scroll
    const lim = SIZE_LIM[k] || SIZE_LIM.bubble, L = this.layout(), v = L.size[k] || 1;
    const nv = Math.max(lim[0], Math.min(lim[1], v * Math.exp(-d * .0016)));
    if (Math.abs(nv - 1) < .015) delete L.size[k]; else L.size[k] = +nv.toFixed(3);
    this.saveLayout(); this.lastInput = performance.now();
    if (k === 'hub') this.hub.y = this.motherY();                      // the star's size moves the orbit and the layout
    const n = this.nodes.get(k), r = this.c.getBoundingClientRect();
    this.sizeTip = { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now(), text: `${SIZE_NAME[k] || (n && n.s && n.s.name) || 'Bubble'} ${Math.round(nv * 100)}%`, edge: nv <= lim[0] + .001 ? 'min' : nv >= lim[1] - .001 ? 'max' : '' };
    return true;
  },
  // screen space, after the world is drawn
  drawSizeTip(ctx) {
    const T = this.sizeTip; if (!T) return;
    const age = (performance.now() - T.t) / 1000; if (age > 1.4) { this.sizeTip = null; return; }
    const txt = T.text + (T.edge ? ` (${T.edge})` : '');
    ctx.save(); ctx.globalAlpha = Math.min(1, (1.4 - age) / .4);
    ctx.font = '600 11px -apple-system, system-ui, sans-serif'; const w = ctx.measureText(txt).width + 16;
    const x = Math.min(this.w - w - 6, T.x + 14), y = Math.max(6, T.y + 14);
    ctx.fillStyle = 'rgba(8,10,20,.85)'; ctx.strokeStyle = 'rgba(190,205,255,.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, 20, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = T.edge ? '#ffd28a' : '#e8edff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, x + 8, y + 10.5);
    ctx.restore();
  },
  // drag-to-move for the black hole / the Endurance (endurance.js objDrag* routes plain drags here)
  objMoveStart(kind, e) {
    const g = kind === 'bh' ? this.bhGeom() : this.endGeom(), p = this.toWorld(e);
    this.objDrag = { kind, move: true, dx: g.x - p.x, dy: g.y - p.y, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY };
    this.c.style.cursor = 'grabbing';
  },
  objMoveTo(e) {
    const d = this.objDrag, p = this.toWorld(e), M = this.compact ? 0 : MAP_M;
    const x = Math.max(-M * this.w + 40, Math.min((1 + M) * this.w - 40, p.x + d.dx)), y = Math.max(-M * this.h + 40, Math.min((1 + M) * this.h - 40, p.y + d.dy));
    // kept as a spot in the orbit plane (radius in ring widths, angle before the system's spin), so it rides the spin
    const sh = this.orbitShape(), k = Math.sign(sh.k || 1) * Math.max(.12, Math.abs(sh.k)), u = x - this.hub.x, v = (y - this.hub.y) / k;
    this.layout().pos[d.kind] = { r: +(Math.hypot(u, v) / sh.rx).toFixed(4), a: +(Math.atan2(v, u) - (this.sysRot || 0)).toFixed(4) }; this.saveLayout();
  },
  // a body that lives in the orbit plane (the black hole, the Endurance): its plane spot (r × the ring's width, angle)
  // turned by the system's spin and seen at the system's tilt — like the sessions, it swings round to the far side
  // (z < 0: behind the star, smaller) and back to the near side (z > 0: in front, bigger)
  planeSpot(kind, defA, defR) {
    const sh = this.orbitShape ? this.orbitShape() : { rx: 300, k: .4 }, P = this.layout().pos[kind];
    let r = defR, a = defA;
    if (P && P.r != null) { r = P.r; a = P.a; }
    else if (P && P.x != null) {                                                  // a spot saved before 2026-10-27 (window fraction)
      const k = Math.sign(sh.k || 1) * Math.max(.12, Math.abs(sh.k)), u = P.x * this.w - this.hub.x, v = (P.y * this.h - this.hub.y) / k;
      r = Math.hypot(u, v) / sh.rx; a = Math.atan2(v, u) - (this.sysRot || 0); this.layout().pos[kind] = { r, a }; this.saveLayout();
    }
    const A = a + (this.sysRot || 0), R = r * sh.rx;
    return { x: this.hub.x + Math.cos(A) * R, y: this.hub.y + Math.sin(A) * R * sh.k, z: Math.sin(A) };
  },
});
