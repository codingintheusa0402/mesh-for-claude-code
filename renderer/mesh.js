// Osmos-style mesh. The core is an Attractor; each Claude session is a translucent mote that
// orbits it and ejects matter (tokens) into it. The cursor behaves like the player's mote:
// moving ejects a propulsion trail and pushes the medium, touching small motes absorbs them,
// clicking empty space fires an ejection burst (shockwave); pinch / scroll zooms the view.
const FAMILY_COLOR = { fable: '#ff5c8a', mythos: '#ff5c8a', opus: "#7d7bff", sonnet: "#2ef0a8", haiku: '#ffb347', other: '#9fb4d8' };
const HEALTH_COLOR = { working: '#7dffc4', idle: '#7c86b8', quiet: '#ffcf6b', waiting: '#ffcf6b', error: '#ff6b7d' };
// deep space: black ground with only a faint violet/blue haze (VOID theme)
const BG = ['#07050f', '#020106', '#000000'], NEB = ['#3a1f8a', '#14306b', '#5a1f6b'];
const STAR_TEMPS = [[[155, 176, 255], .1], [[202, 215, 255], .2], [[248, 247, 255], .3], [[255, 240, 222], .18], [[255, 214, 170], .13], [[255, 170, 140], .09]];   // [rgb, share]: O/B … M
const AMBIENT_COLORS = ['#5ec8ff', '#3ee6b0', '#8f8bff', '#ff6b8b', '#b98bff', '#4fa3ff'];

function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function hexA(hex, a) { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; }
function mix(hex, t) { const c = rgb(hex).map(v => Math.round(v + (255 - v) * t)); return "#" + c.map(v => v.toString(16).padStart(2, "0")).join(""); }
// session bubbles darken as today's spend grows ($0 → bright, ~$40+ → darkest); resets at midnight with todayUsd
function spendDim(s) { return Math.min(.62, Math.log10(1 + Math.max(0, s.todayUsd || 0)) / Math.log10(41) * .62); }
function darken(hex, k) { return '#' + rgb(hex).map(v => Math.round(v * (1 - k)).toString(16).padStart(2, '0')).join(''); }
function sessionColor(s) { return darken(FAMILY_COLOR[s.family] || '#9fb4d8', spendDim(s)); }
function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967295; }
function rnd(seed) { let s = seed * 1e9 | 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296; }

// Pre-rendered translucent mote sprite (rim-lit cell with nebula speckle), cached per colour.
const spriteCache = new Map();
function moteSprite(color, speckles = true) {
  const key = color + speckles;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'), R = S / 2 - 6, C = S / 2;
  const body = x.createRadialGradient(C, C, 0, C, C, R);
  body.addColorStop(0, hexA(color, .22)); body.addColorStop(.62, hexA(color, .26));
  body.addColorStop(.84, hexA(color, .6)); body.addColorStop(.96, hexA(mix(color, .6), 1)); body.addColorStop(1, hexA(color, 0));
  x.fillStyle = body; x.beginPath(); x.arc(C, C, R, 0, 7); x.fill();
  if (speckles) {
    const r = rnd(hash(color));
    for (let i = 0; i < 260; i++) {
      const a = r() * 6.283, d = Math.pow(r(), .7) * R * .86;
      x.fillStyle = hexA(r() > .8 ? '#ffffff' : mix(color, r() * .6), .25 + r() * .55);
      x.beginPath(); x.arc(C + Math.cos(a) * d, C + Math.sin(a) * d, .6 + r() * 2.2, 0, 7); x.fill();
    }
  }
  const spec = x.createRadialGradient(C - R * .38, C - R * .42, 0, C - R * .38, C - R * .42, R * .55);
  spec.addColorStop(0, 'rgba(255,255,255,.35)'); spec.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = spec; x.beginPath(); x.arc(C, C, R, 0, 7); x.fill();
  spriteCache.set(key, c); return c;
}
function glowSprite(color) {
  const key = 'g' + color; if (spriteCache.has(key)) return spriteCache.get(key);
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, hexA(color, .9)); g.addColorStop(.25, hexA(color, .35)); g.addColorStop(1, hexA(color, 0));
  x.fillStyle = g; x.fillRect(0, 0, S, S); spriteCache.set(key, c); return c;
}

class Mesh {
  constructor(canvas, { onSelect, onHub }) {
    this.c = canvas; this.ctx = canvas.getContext('2d');
    this.onSelect = onSelect; this.onHub = onHub; this.onHold = null;   // onHold(sid, clientX, clientY): press-and-hold
    this.nodes = new Map(); this.matter = []; this.fx = [];
    this.selected = null; this.hover = null;
    this.hub = { x: 0, y: 0, tps: 0, usd: 0, count: 0, mass: 0 };
    this.time = 0;
    this.cursor = { x: -999, y: -999, px: -999, py: -999, vx: 0, vy: 0, r: 11, in: false, mass: 0 };
    // star colours by age, roughly as in the real sky: young hot stars blue-white, old cool ones orange-red
    const pickStar = () => { let r = Math.random(); return (STAR_TEMPS.find(t => (r -= t[1]) < 0) || STAR_TEMPS[2])[0]; };
    this.stars = [0, 1, 2].map(layer => Array.from({ length: 90 + layer * 40 }, () => ({
      x: Math.random(), y: Math.random(), s: Math.random(), tw: Math.random() * 6.28, layer, col: pickStar(),
      blink: Math.random() < .45, f: .18 + Math.random() * .42,      // ~45 % twinkle, slowly (one cycle every ~10–35 s)
    })));
    this.ambient = [];                    // bubbles blown by the sessions (bubbles.js)
    canvas.addEventListener('mousemove', e => { this.lastInput = performance.now(); this.move(e); });
    canvas.addEventListener('mouseenter', () => { this.cursor.in = true; });
    canvas.addEventListener('mouseleave', () => { this.cursor.in = false; this.hover = null; this.probeHover = false; });
    canvas.addEventListener('mousedown', e => this.down(e));
    this.cam = { s: 1, tx: 0, ty: 0, ts: 1, ttx: 0, tty: 0 };      // view zoom (t* = target, eased toward)
    canvas.addEventListener('wheel', e => { this.lastInput = performance.now(); this.wheelZoom(e); }, { passive: false });
    canvas.addEventListener('dblclick', e => { if (this.hitProbe && this.hitProbe(this.toWorld(e))) return; const h = this.hit(e); if (!h) { Object.assign(this.cam, { ts: 1, ttx: 0, tty: 0 }); this.sysTilt = 0; try { localStorage.setItem('mesh.sysTilt', '0'); } catch { } } else if (h !== 'hub') this.unpin(h); });
    addEventListener('mousemove', e => {
      if (this.hubPress) {
        const hp = this.hubPress; if (Math.hypot(e.clientX - hp.x0, e.clientY - hp.y0) <= 5) return;
        this.hubPress = null; this.sysVel = 0; this.spinDrag = { x: hp.x0, y: hp.y0, near: true, t: performance.now(), v: 0 }; this.c.style.cursor = 'grabbing';
      }
      if (this.probeGrab) return this.probeGrabMove(e);
      if (this.objDrag) return this.objDragMove(e);                  // turning the Endurance / tilting the black hole (endurance.js)
      if (this.spinDrag) return this.spinMove(e);
      if (this.drag) return this.dragMove(e);
      const p = this.pan; if (!p) return;
      if (!p.moved && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 4) { p.moved = true; this.c.style.cursor = 'grabbing'; }
      if (p.moved) { this.cam.ttx = p.tx + e.clientX - p.x0; this.cam.tty = p.ty + e.clientY - p.y0; this.clampCam(); this.cam.tx = this.cam.ttx; this.cam.ty = this.cam.tty; }
    });
    addEventListener('mouseup', () => {
      if (this.hubPress) { this.hubPress = null; this.c.style.cursor = ''; return this.onHub(); }
      if (this.probeGrab) return this.probeGrabEnd();
      if (this.objDrag) return this.objDragEnd();
      if (this.spinDrag) return this.spinEnd();
      this.dragEnd();
      const p = this.pan; this.pan = null; if (!p) return;
      this.c.style.cursor = ''; if (!p.moved) this.burst(p.e);
    });
    new ResizeObserver(() => { this.resize(); this.wake(); }).observe(canvas);
    this.resize();
    // anything you do anywhere in the window can change what's drawn
    for (const ev of ['pointerdown', 'keydown', 'focus', 'blur']) addEventListener(ev, () => this.wake(), true);
    document.addEventListener('visibilitychange', () => this.wake());
    this.wake(8000);                                               // first draw, textures still arriving
    requestAnimationFrame(t => this.frame(t));
  }

  // Render on demand (Kevin 2026-11-07): the mesh draws for 3 seconds after something changes, then holds still and costs nothing.
  get lastInput() { return this._lastInput; }
  set lastInput(v) { this._lastInput = v; this.kick(); }
  wake(ms = 3000) { this.wakeUntil = Math.max(this.wakeUntil || 0, performance.now() + ms); this.kick(); }
  kick() { if (this.sleepT) { clearTimeout(this.sleepT); this.sleepT = 0; requestAnimationFrame(t => this.frame(t)); } }

  newAmbient(anywhere) {
    const v = this.cam ? this.view() : { x0: 0, y0: 0, x1: this.w || 1200, y1: this.h || 700 }, w = v.x1 - v.x0, h = v.y1 - v.y0;
    const r = 2 + Math.pow(Math.random(), 2.4) * 16, edge = Math.random() * 4 | 0;
    return {
      x: v.x0 + (anywhere ? Math.random() * w : edge === 0 ? -20 : edge === 1 ? w + 20 : Math.random() * w),
      y: v.y0 + (anywhere ? Math.random() * h : edge === 2 ? -20 : edge === 3 ? h + 20 : Math.random() * h),
      vx: (Math.random() - .5) * 8, vy: (Math.random() - .5) * 8, r, depth: .3 + Math.random() * .7,
      color: AMBIENT_COLORS[Math.random() * AMBIENT_COLORS.length | 0], born: this.time,
    };
  }

  // ambient medium: motes drift, wrap back in from the edges, and part around the cursor
  simAmbient(dt, cspd) {
    const cur = this.cursor, v = this.view(), target = Math.round(40 * Math.min(2.2, 1 / (this.cam.s * this.cam.s)) ** .5);
    while (this.ambient.length < target) this.ambient.push(this.newAmbient(false));
    if (this.ambient.length > target) this.ambient.length = target;
    for (const m of this.ambient) {
      if (cur.in) {
        const dx = m.x - cur.x, dy = m.y - cur.y, d = Math.hypot(dx, dy), R = 70 + m.r;
        if (d < R && d > 1) { const f = (1 - d / R) * (40 + cspd * .4); m.vx += dx / d * f * dt; m.vy += dy / d * f * dt; }
      }
      const damp = Math.pow(.7, dt); m.vx = m.vx * damp + (Math.random() - .5) * 4 * dt; m.vy = m.vy * damp + (Math.random() - .5) * 4 * dt;
      m.x += m.vx * dt; m.y += m.vy * dt;
      if (m.x < v.x0 - 40) m.x = v.x1 + 30; else if (m.x > v.x1 + 40) m.x = v.x0 - 30;
      if (m.y < v.y0 - 40) m.y = v.y1 + 30; else if (m.y > v.y1 + 40) m.y = v.y0 - 30;
    }
  }

  // ---- zoom: pinch or scroll, anchored at the pointer, 0.5× (wide: the whole map) … 2× (close) ----
  wheelZoom(e) {
    if (this.wheelResize && this.wheelResize(e)) return;          // shift + scroll over an object: resize it (handles.js)
    e.preventDefault();
    const r = this.c.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, c = this.cam;
    const k = Math.exp(-e.deltaY * (e.ctrlKey ? .012 : .0018));          // ctrlKey = trackpad pinch
    const s = Math.min(2, Math.max(this.portals && this.portals.size ? .34 : .5, c.ts * k));   // .5× shows the whole 2× map (.34× the wider one groups get)
    c.ttx = px - (px - c.ttx) * s / c.ts; c.tty = py - (py - c.tty) * s / c.ts; c.ts = s;
    this.clampCam();
  }

  // the map extends half a window beyond the window on every side (2× size); the view can roam inside that
  clampCam() {
    const c = this.cam, W = this.w, H = this.h, M = this.portals && this.portals.size ? 1 : MAP_M;   // groups orbit up to twice as far → a wider map
    const fit = (t, size) => {
      const lo = -(1 + M) * size * c.ts + size, hi = M * size * c.ts;      // view edge stays within [-M·size, (1+M)·size]
      return lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, t));
    };
    c.ttx = fit(c.ttx, W); c.tty = fit(c.tty, H);
  }

  stepCam(dt) {
    const c = this.cam, a = 1 - Math.pow(.0005, dt);
    c.s += (c.ts - c.s) * a; c.tx += (c.ttx - c.tx) * a; c.ty += (c.tty - c.ty) * a;
  }

  view() { const c = this.cam; return { x0: -c.tx / c.s, y0: -c.ty / c.s, x1: (this.w - c.tx) / c.s, y1: (this.h - c.ty) / c.s }; }
  toWorld(e) { const r = this.c.getBoundingClientRect(), c = this.cam; return { x: (e.clientX - r.left - c.tx) / c.s, y: (e.clientY - r.top - c.ty) / c.s }; }

  drawBackdrop(ctx, W, H, parX, parY) {
    const d = this.dpr(), key = W + 'x' + H + '@' + d;
    if (!this.bg || this.bg.key !== key) {
      const mk = () => { const c = document.createElement('canvas'); c.width = Math.ceil(W * d); c.height = Math.ceil(H * d); const x = c.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); return [c, x]; };
      const [base, bx] = mk();
      const g = bx.createRadialGradient(W * .5, H * .45, 0, W * .5, H * .5, Math.max(W, H) * .8);
      g.addColorStop(0, BG[0]); g.addColorStop(.45, BG[1]); g.addColorStop(1, BG[2]); bx.fillStyle = g; bx.fillRect(0, 0, W, H);
      for (const [nx, ny, col] of [[.22, .28, NEB[0]], [.8, .72, NEB[1]], [.7, .2, NEB[2]]]) {
        const ng = bx.createRadialGradient(W * nx, H * ny, 0, W * nx, H * ny, Math.max(W, H) * .42);
        ng.addColorStop(0, hexA(col, .16)); ng.addColorStop(1, hexA(col, 0)); bx.fillStyle = ng; bx.fillRect(0, 0, W, H);
      }
      // all star layers in one canvas with a margin, so parallax is one blit (no wrap-around tiling)
      const M = 160, sc = document.createElement('canvas'); sc.width = Math.ceil((W + 2 * M) * d); sc.height = Math.ceil((H + 2 * M) * d);
      const sx = sc.getContext('2d'); sx.setTransform(d, 0, 0, d, 0, 0);
      for (const layer of this.stars) for (const s of layer) {
        if (s.blink) continue;                                                  // twinkling ones are drawn live
        sx.fillStyle = `rgba(${s.col.join()},${(.15 + .5 * s.s) * .8})`; const z = .5 + s.s * (s.layer * .5 + .6);
        sx.fillRect(s.x * (W + 2 * M), s.y * (H + 2 * M), z, z);
      }
      const layers = { c: sc, M };
      const tw = this.stars.flat().filter(s => s.blink);
      this.bg = { key, base, layers, tw };
    }
    ctx.drawImage(this.bg.base, 0, 0, W, H);
    { const { c, M } = this.bg.layers, ox = Math.max(-M, Math.min(M, -parX * 12 + this.cam.tx * .12)), oy = Math.max(-M, Math.min(M, -parY * 12 + this.cam.ty * .12));
      if (!this.off('mStars')) ctx.drawImage(c, ox - M, oy - M, W + 2 * M, H + 2 * M); }
    if (!this.off('mStars')) for (const s of this.bg.tw) {
      const { M } = this.bg.layers, ox = Math.max(-M, Math.min(M, -parX * 12 + this.cam.tx * .12)), oy = Math.max(-M, Math.min(M, -parY * 12 + this.cam.ty * .12));
      const x = s.x * (W + 2 * M) - M + ox, y = s.y * (H + 2 * M) - M + oy;
      const k = .5 + .5 * Math.sin(this.time * s.f + s.tw), a = (.15 + .55 * s.s) * (.12 + .88 * k * k);   // slow swell and fade
      if (a > .02) {
        const z = .7 + s.s * (s.layer * .5 + .7) * (.85 + .3 * k);
        ctx.fillStyle = `rgba(${s.col.join()},${a})`; ctx.fillRect(x - z / 2, y - z / 2, z, z);
        if (s.s > .8 && k > .7) { ctx.fillStyle = `rgba(${s.col.join()},${a * .25})`; ctx.fillRect(x - z * 1.6, y - .25, z * 3.2, .5); ctx.fillRect(x - .25, y - z * 1.6, .5, z * 3.2); }   // brightest flare
      }
    }
  }

  resize() {
    const r = this.c.getBoundingClientRect(), d = this.dpr();
    this.w = r.width; this.h = r.height;
    this.c.width = Math.max(1, r.width * d); this.c.height = Math.max(1, r.height * d);
    this.ctx.setTransform(d, 0, 0, d, 0, 0);
    this.hub.x = this.w / 2; this.hub.y = this.motherY();
    if (this.cam) { this.clampCam(); Object.assign(this.cam, { tx: this.cam.ttx, ty: this.cam.tty }); }
  }

  update(snap) {
    const seen = new Set();
    for (const s of snap.sessions) {
      seen.add(s.sid);
      let n = this.nodes.get(s.sid);
      if (!n) {
        const seed = hash(s.sid);
        n = { sid: s.sid, seed, x: this.hub.x, y: this.hub.y, vx: 0, vy: 0, born: this.time, acc: 0, s, flash: 0, spin: seed * 6.28, r: 10, swell: 0, phase: 0 };
        const rr = rnd(seed); n.inner = Array.from({ length: 22 }, () => ({ a: rr() * 6.28, d: .15 + rr() * .7, sp: (rr() - .5) * 1.4, sz: .7 + rr() * 1.8 }));
        this.nodes.set(s.sid, n);
      }
      if (n.s.health !== 'error' && s.health === 'error') n.flash = 1;
      if ((n.s.health === 'working' || n.s.health === 'quiet') && (s.health === 'idle' || s.health === 'waiting')) n.nova = this.time;   // prompt done → star birth (organism.js drawNova)
      n.s = s; n.dying = 0;   // a session that reappears after a missed snapshot is alive again
    }
    for (const [sid, n] of this.nodes) if (!seen.has(sid) && !n.dying) n.dying = this.time;
    this.groups = snap.groups || {};   // session groups → portals (portal.js)
    this.hub.tps = snap.sessions.reduce((a, s) => a + s.tps, 0);
    this.hub.usd = snap.todayUsd; this.hub.tok = snap.todayTok; this.hub.count = snap.sessions.length; this.hub.usage = snap.usage; this.hub.peer = snap.peer;
    this.hub.working = snap.sessions.filter(s => s.health === 'working').length; this.hub.ready = !!snap.ready;
    // a session arriving, leaving or changing state animates; numbers alone redraw one still frame, at most every 5 seconds
    { const shape = snap.sessions.map(s => [s.sid, s.health, s.name, s.color, s.subagents, s.parent].join()).join('|'), text = snap.sessions.map(s => [s.tok, s.tps, s.model].join()).join('|') + (this.hub.tok || '');
      if (shape !== this.shapeSig) { this.shapeSig = shape; this.wake(); }
      else if (text !== this.textSig) { this.textSig = text; const n = performance.now(); if (n - (this.stillAt || 0) > 5000) { this.stillAt = n; this.drawOne = true; this.kick(); } } }
    if (snap.peer && snap.peer.selfLabel) this.selfLabel = snap.peer.selfLabel;   // which Mac this is (peer.json), for the fps tag
  }

  // home slot on an elliptical orbit around the attractor; slots drift slowly (≈ one lap / 15 min)
  home(n, list, i) {
    const lap = this.time * (6.283 / 900);
    const a = -Math.PI / 2 + (i / Math.max(1, list.length)) * 6.283 + lap;
    const ring = list.length > 7 && i % 2 ? .66 : 1;
    const rx = Math.max(this.galaxyRadius() + 110, this.w / 2 - 130) * ring, ry = Math.max(this.galaxyRadius() + 90, this.h / 2 - 90) * ring;
    return { x: this.hub.x + Math.cos(a) * rx, y: this.hub.y + Math.sin(a) * ry };
  }

  command(sid) {
    const n = this.nodes.get(sid); if (!n) return;
    for (let i = 0; i < 26; i++) {
      const a = Math.atan2(n.y - this.hub.y, n.x - this.hub.x) + (Math.random() - .5) * .5, sp = 220 + Math.random() * 160;
      this.matter.push({ x: this.hub.x, y: this.hub.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 1.5 + Math.random() * 2, color: '#ffffff', target: n, life: 3 });
    }
    n.flash = .9;
  }

  nodeRadius(n) { return 22 + Math.min(30, Math.log10(1 + (n.s.totalUsd || 0)) * 10); }

  // Frame governor: every display refresh (120–144 Hz on a ProMotion / high-refresh screen — user ask 2026-10-21,
  // so the star turns smoothly; it used to be 30 idle / 60 interacting);
  // nothing at all while the window is hidden/minimised or the mesh is off-screen (Grid view).
  frame(now) {
    if (document.hidden || this.offscreen || this.paused || document.body.dataset.view === 'grid' || !this.w) {
      // not drawing: the HTML overlays (probe speech bubble + menu, the black hole's Undo pill) go too
      if (this.sayEl && this.sayEl.style.display !== 'none') { this.sayEl.style.display = 'none'; this.sayHover = false; }
      if (this.pmEl && this.probeMenuClose) this.probeMenuClose();
      if (this.bhUndoHide) this.bhUndoHide();
      this.sizeTip = null;
      this.last = this.lastPx = 0; setTimeout(() => requestAnimationFrame(t => this.frame(t)), 250); return;
    }
    { const P = this.probe, moving = now < (this.wakeUntil || 0) || now - (this.lastInput || 0) < 3000 || this.sysVel || this.spinDrag || this.drag || this.objDrag || this.probeGrab || this.pan || this.cine
        || (P && (P.held || P.fall || P.grav)) || this.bhArmT || this.sizeTip || [...this.nodes.values()].some(n => n.eaten && !n.eaten.done);
      if (!moving && !this.drawOne) {
        if (this.cineStep) this.cineStep(.5);                      // the screen saver's idle clock keeps counting
        this.last = this.lastPx = 0; this.dueAt = null;
        if (!this.cine) { this.sleepT = setTimeout(() => { this.sleepT = 0; requestAnimationFrame(t => this.frame(t)); }, 500); return; }
      }
      this.drawOne = false; }
    // iPhone (lite): 60 fps while you touch it or it's spinning, 30 fps otherwise — a 120 Hz phone otherwise burns
    // every frame on the full scene and stutters
    if (this.lite && this.last && now - this.last < (now - (this.lastInput || 0) < 2500 || this.sysVel || this.spinDrag ? 15 : 31)) { requestAnimationFrame(t => this.frame(t)); return; }
    // the Mac (2026-10-28, "using significant energy"): 60 fps only while something needs it — your input in the last 3 s,
    // a spin / coast, a drag, the screen saver, something falling into the black hole, the probe being hauled about —
    // (in front: 80 fps; another app in front: 60, or 30 while frames are heavy)
    // the display's tick, measured from every rAF callback (skipped ones too): 6.9 ms at 144 Hz, 8.3 at 120, 16.7 at 60
    { const raw = now - (this.rafPrev || now); this.rafPrev = now; if (raw > 2 && raw < 40) this.tickMs = (this.tickMs || raw) + (raw - (this.tickMs || raw)) * .05; }
    if (!this.lite && this.last) {
      const P = this.probe, busy = now - (this.lastInput || 0) < 3000 || this.sysVel || this.spinDrag || this.drag || this.objDrag || this.probeGrab || this.cine
        || (P && (P.held || P.fall || P.grav)) || this.bhArmT || this.sizeTip || [...this.nodes.values()].some(n => n.eaten && !n.eaten.done);
      const front = document.hasFocus(); this.bgMode = !front && !busy;   // another app in front → 60 fps (30 when frames are heavy)
      // 2026-10-29 (Kevin: "80fps default, screen saver 144 unless busy, then 60"; "untouched at least 60 unless draining"):
      // 80 fps with Mesh in front, 60 behind other apps (30 only while frames are heavy: > 9 ms of main thread each, or
      // arriving late — re-checked after 30 s); the screen saver at the display's own rate (up to 144 Hz), 60 when cineStep sees it can't keep up.
      // Paced on a running schedule (next frame due = last due + period), not "time since the last frame": the old
      // 15.5 ms gap rounded up to every 3rd tick on a 144 Hz display = 48 fps.
      const period = this.cine && !this.cineHiOff ? 0 : this.cine ? 1000 / 60 : busy || front ? 1000 / 80 : this.heavy ? 1000 / 30 : 1000 / 60;
      if (period) {
        const half = (this.tickMs || 8) * .5;
        if (this.dueAt == null || now - this.dueAt > 250) this.dueAt = now;              // (first frame / after a stall)
        if (now < this.dueAt - half) { requestAnimationFrame(t => this.frame(t)); return; }
        this.dueAt += period;
      } else this.dueAt = null;
    }
    this.lastDraw = now; this.workT0 = performance.now();
    const realDt = Math.min(.1, (now - (this.last || now)) / 1000); this.last = now;
    const dt = realDt; this.time += dt; this.stepCam(realDt);
    if (this.cineStep) this.cineStep(realDt);                      // screen saver: the camera takes over after 3 min idle (cine.js)
    if (!this.spinDrag && this.sysVel) {                         // coasting after a flick of the orbit ring
      this.sysRot = (this.sysRot || 0) + this.sysVel * dt; this.sysVel *= Math.pow(.3, dt);
      if (Math.abs(this.sysVel) < .01) { this.sysVel = 0; try { localStorage.setItem('mesh.sysRot', String(this.sysRot)); } catch { } }
    }
    const ctx = this.ctx, W = this.w, H = this.h, cur = this.cursor;
    cur.vx = cur.vx * .85 + (cur.x - cur.px) / Math.max(realDt, .001) * .15;
    cur.vy = cur.vy * .85 + (cur.y - cur.py) / Math.max(realDt, .001) * .15;
    cur.px = cur.x; cur.py = cur.y;
    const cspd = Math.hypot(cur.vx, cur.vy);
    const parX = cur.in ? (cur.x / W - .5) : 0, parY = cur.in ? (cur.y / H - .5) : 0;

    // --- deep indigo nebula backdrop + parallax starfield (pre-rendered; only a few stars twinkle live)
    this.drawBackdrop(ctx, W, H, parX, parY);

    const d = this.dpr(), cam = this.cam;
    ctx.setTransform(d * cam.s, 0, 0, d * cam.s, d * cam.tx, d * cam.ty);   // world space from here on
    // --- sessions orbit the mother; their bubbles drift, shimmer and fall into it
    this.simAmbient(dt, cspd);
    this.stepSessions(dt, realDt, cspd);
    this.drawLinks(ctx);
    this.drawBubbles(ctx, parX, parY);
    if (this.drawEndurance) this.drawEndurance(ctx, 'far');                              // the probe's station (endurance.js), when it's on the far side of the orbit
    if (this.drawBlackHole) this.drawBlackHole(ctx, 'back', realDt, 'far');              // the black hole bin (blackhole.js): steps it; draws it here when on the far side

    ctx.globalCompositeOperation = 'lighter';
    this.matter = this.matter.filter(p => {
      p.life -= dt;
      if (p.target) {                      // command matter flies to its session
        if (!this.nodes.has(p.target.sid)) return false;
        const dx = p.target.x - p.x, dy = p.target.y - p.y, d = Math.hypot(dx, dy);
        if (d < this.nodeRadius(p.target)) { p.target.flash = Math.min(1, p.target.flash + .06); return false; }
        p.vx += dx / d * 900 * dt; p.vy += dy / d * 900 * dt; p.vx *= .96; p.vy *= .96;
      } else if (!p.free) {                // attractor gravity
        const dx = this.hub.x - p.x, dy = this.hub.y - p.y, d = Math.max(20, Math.hypot(dx, dy));
        if (d < this.galaxyRadius() * .2 + this.hub.mass) { this.hub.mass = Math.min(14, this.hub.mass + p.r * .25); return false; }
        const G = (90000 / (d * d) + 30) * (this.sizeOf ? this.sizeOf('hub') : 1);   // a bigger star pulls harder p.vx += dx / d * G * dt; p.vy += dy / d * G * dt;
        p.vx *= Math.pow(.6, dt); p.vy *= Math.pow(.6, dt);
      } else { p.vx *= Math.pow(.25, dt); p.vy *= Math.pow(.25, dt); }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const a = Math.min(1, p.life / 1.2);
      const gs = glowSprite(p.color), sz = p.r * 6;
      ctx.globalAlpha = a; ctx.drawImage(gs, p.x - sz / 2, p.y - sz / 2, sz, sz); ctx.globalAlpha = 1;
      return p.life > 0;
    });
    ctx.globalCompositeOperation = 'source-over';
    if (this.matter.length > 1500) this.matter.splice(0, this.matter.length - 1500);

    // depth order: the far half of the orbit (and the sessions on it) behind the star, the near half in front
    const order = [...this.nodes.values(), ...(this.portalNodes ? this.portalNodes() : [])].sort((a, b) => (a.z || 0) - (b.z || 0));   // + groups' main bubbles
    this.drawOrbitRing(ctx, false);
    this.drawSessionOrbits(ctx, false);
    if (this.drawPortals) this.drawPortals(ctx, 'back', realDt);
    for (const n of order) if ((n.z || 0) < 0) this.drawMote(n, realDt);
    const probeOn = this.drawProbe && !this.off('mProbe');
    if (probeOn) this.drawProbe(ctx, realDt, 'back');                                    // the probe droid (probe.js): moves; drawn here when on the far side
    this.drawAttractor(realDt);
    if (this.drawEndurance) this.drawEndurance(ctx, 'near');                             // … or here, in front of the star, on the near side
    if (this.drawBlackHole) this.drawBlackHole(ctx, 'back', realDt, 'near');
    this.drawOrbitRing(ctx, true);
    this.drawSessionOrbits(ctx, true);
    for (const n of order) if ((n.z || 0) >= 0) this.drawMote(n, realDt);
    if (this.drawPortals) this.drawPortals(ctx, 'front', realDt);
    if (this.drawBlackHole) this.drawBlackHole(ctx, 'front', realDt);                    // … its near disk, over whatever it's swallowing
    if (probeOn) this.drawProbe(ctx, realDt, 'front');                                   // … or here when on the near side
    this.drawMotherInfo();
    this.drawFx(realDt);
    if (probeOn && (!this.cineClean || this.cineTalk)) this.drawProbeSay(ctx); else if (this.sayEl) this.sayEl.style.display = 'none';                                                // its speech bubble on top of everything
    if (this.pmEl && (!probeOn || this.compact || !this.c.offsetWidth)) this.probeMenuClose();                  // … and its command menu goes with it
    this.drawCursor(realDt, cspd);

    ctx.setTransform(d, 0, 0, d, 0, 0);
    this.drawFps(ctx, now);
    if (this.drawSizeTip) this.drawSizeTip(ctx);
    if (this.drawCine) this.drawCine(ctx);
    // how heavy a frame is (main-thread ms, smoothed) and whether frames come late: decides 60 vs 30 fps behind other apps
    { const w = performance.now() - this.workT0; this.workMs = (this.workMs ?? w) + (w - (this.workMs ?? w)) * .05;
      const late = this.bgMode && realDt > .024;                                   // a 60 fps frame that took > 24 ms to come
      this.lateN = Math.max(0, (this.lateN || 0) + (late ? 1 : -.25));
      if (!this.heavy && (this.workMs > 9 || this.lateN > 30)) { this.heavy = true; this.heavyAt = now; }
      else if (this.heavy && this.workMs < 6 && now - this.heavyAt > 30000) { this.heavy = false; this.lateN = 0; } }
    requestAnimationFrame(t => this.frame(t));
  }

  // live frame rate of THIS device (Mac mini / MacBook / iPhone each render their own mesh), top-right, 50 % white;
  // counted over ½-second windows so it reads steady but follows real drops
  drawFps(ctx, now) {
    const f = this.fpsM || (this.fpsM = { n: 0, t0: now, v: 0 });
    f.n++; if (now - f.t0 >= 500) { f.v = Math.round(f.n * 1000 / (now - f.t0)); f.n = 0; f.t0 = now; }
    if (!f.v) return;
    const dev = /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : ({ MacMini: 'Mac mini', MacBook: 'MacBook' })[this.selfLabel] || this.selfLabel || '';
    ctx.save(); ctx.font = '500 11px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillText(`${dev ? dev + ' · ' : ''}${f.v} fps`, this.w - 12, 10);
    ctx.restore();
  }

  // the orbit plane, seen tilted: a faint ellipse, its far half drawn behind the star and its near half in front
  drawOrbitRing(ctx, near) {
    if (this.off('mRing')) return;
    if (!this.orbitShape || this.compact) return;
    const { rx, k } = this.orbitShape(), hx = this.hub.x, hy = this.hub.y;
    ctx.save(); ctx.lineWidth = 1;
    const lit = this.spinDrag ? 3 : this.ringHover ? 2 : 1;          // the ring brightens when it can be grabbed / while spinning
    if (!this.off('mSpinBand')) this.drawSpinBand(ctx, near, lit);   // Window ▸ Orbit control disk (it still spins when hidden)
    if (!this.off('mOrbitLines')) for (const [f, a0] of [[1, near ? .1 : .05], [.62, near ? .06 : .03]]) {   // Window ▸ Orbit lines hides these (the band stays)
      const a = f === 1 ? a0 * lit : a0;
      const g = ctx.createLinearGradient(0, hy - rx * k * f, 0, hy + rx * k * f);          // brighter toward the near side
      g.addColorStop(0, `rgba(170,190,255,${a * .4})`); g.addColorStop(1, `rgba(170,190,255,${a})`);
      const up = k < 0;                                                                     // seen from below: near half is the top
      ctx.strokeStyle = g; ctx.beginPath(); ctx.ellipse(hx, hy, rx * f, Math.abs(rx * k * f), 0, near !== up ? 0 : Math.PI, near !== up ? Math.PI : 6.2832); ctx.stroke();
    }
    ctx.restore();
  }

  // the grab zone for spinning the system (onRing: .88–1.25 × the ring) drawn as a faint track with grip ticks that turn
  // with the system, so it's clear which band to drag; brighter on hover / while spinning, "drag to spin" on hover
  drawSpinBand(ctx, near, lit) {
    const { rx, k } = this.orbitShape(), hx = this.hub.x, hy = this.hub.y, up = k < 0, A = Math.abs(k);
    const a0 = near !== up ? 0 : Math.PI, a1 = a0 + Math.PI, R0 = .88, R1 = 1.25;
    const fill = [0, .045, .075, .1][lit] * (near ? 1 : .6);
    ctx.fillStyle = `rgba(150,175,255,${fill})`; ctx.beginPath();
    ctx.ellipse(hx, hy, rx * R1, rx * R1 * A, 0, a0, a1);
    ctx.ellipse(hx, hy, rx * R0, rx * R0 * A, 0, a1, a0, true); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = `rgba(170,190,255,${fill * 1.6})`; ctx.setLineDash([3, 5]);         // dashed edges of the track
    for (const r of [R0, R1]) { ctx.beginPath(); ctx.ellipse(hx, hy, rx * r, rx * r * A, 0, a0, a1); ctx.stroke(); }
    ctx.setLineDash([]);
    const N = 96, rot = this.sysRot || 0;                                                   // grip ticks, riding the spin
    ctx.strokeStyle = `rgba(190,205,255,${fill * 2.6})`; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const b = i / N * 6.2832 + rot; if (((Math.sin(b) >= 0) === up) === near) continue;
      const c = Math.cos(b), sn = Math.sin(b) * k;
      ctx.moveTo(hx + c * rx * 1.0, hy + sn * rx * 1.0); ctx.lineTo(hx + c * rx * 1.14, hy + sn * rx * 1.14);
    }
    ctx.stroke();
    if (near && this.ringHover && !this.spinDrag) {                                         // hint at the pointer
      ctx.font = '500 11px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(200,215,255,.75)'; ctx.fillText('drag to spin · up/down to tilt', this.cursor.x + 14, this.cursor.y - 8);
    }
  }

  // each session's own orbit, dimly: a hairline ellipse (hand-placed orbits only — automatic ones ride the main ring)
  // plus a trail in the session's rim colour fading out behind it, so you can see where and which way it spins
  drawSessionOrbits(ctx, near) {
    if (this.off('mTrails') || this.off('mOrbitLines')) return;     // Window ▸ Orbit lines hides these too (the coloured trails)
    if (!this.orbitShape || this.compact) return;
    const orb = this.loadOrbits(), sh = this.orbitShape(), hx = this.hub.x, hy = this.hub.y, now = Date.now(), TRAIL = 1.6, N = 40;
    ctx.save(); ctx.lineWidth = 1.2; ctx.lineCap = 'round';
    for (const n of this.nodes.values()) {
      const o = orb[n.sid]; if (!o || n.dragging || n.moon) continue;
      if (n.gslot && this.portals && this.portals.get(n.s.group) && this.portals.get(n.s.group).members[0] !== n) continue;   // a group rides its first member's orbit
      const s = n.s, fam = n.gslot ? 'portal' : s.color && ORB_PAL[s.color] ? s.color : s.serverUses ? 'server' : ORB_PAL[s.family] ? s.family : 'other';   // a group's orbit: gold
      const h = ORB_PAL[fam].rim, rgb = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(',');
      const fade = n.dying ? Math.max(0, 1 - (this.time - n.dying) / 2.5) : Math.min(1, (this.time - n.born) / 1.2);
      const ct = Math.cos(o.tilt || 0), st = Math.sin(o.tilt || 0);
      const rx = o.auto ? sh.rx : Math.min(o.rx, this.maxOrbit()), ry = rx * sh.k, a = o.a0 + this.omegaAt(rx) * (now - o.t0) / 1000 + (this.sysRot || 0);
      if (!o.auto) {
        ctx.strokeStyle = `rgba(${rgb},${.09 * fade})`; ctx.beginPath();
        const up = sh.k < 0; ctx.ellipse(hx, hy, rx, Math.abs(ry), o.tilt || 0, near !== up ? 0 : Math.PI, near !== up ? Math.PI : 6.2832); ctx.stroke();
      }
      for (let i = 0; i < N; i++) {                     // tail (i = 0) → head (i = N-1); far half drawn behind the star
        const b0 = a - TRAIL * (1 - i / N), b1 = a - TRAIL * (1 - (i + 1) / N);
        if ((Math.sin((b0 + b1) / 2) >= 0) !== near) continue;
        ctx.strokeStyle = `rgba(${rgb},${.5 * Math.pow((i + 1) / N, 1.5) * fade})`;
        const X = b => Math.cos(b) * rx * ct - Math.sin(b) * ry * st, Y = b => Math.cos(b) * rx * st + Math.sin(b) * ry * ct;   // rolled by the orbit's tilt
        ctx.beginPath(); ctx.moveTo(hx + X(b0), hy + Y(b0)); ctx.lineTo(hx + X(b1), hy + Y(b1)); ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawAttractor(dt) {
    const ctx = this.ctx, h = this.hub, t = this.time;
    if (!Number.isFinite(h.mass)) h.mass = 0;
    h.mass *= Math.pow(.5, dt);
    const R = 30 + h.mass + Math.sin(t * 1.6) * 1.5;
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(h.x, h.y, R * .5, h.x, h.y, R * 5);
    halo.addColorStop(0, 'rgba(140,200,255,.30)'); halo.addColorStop(.4, 'rgba(90,120,255,.08)'); halo.addColorStop(1, 'rgba(60,80,255,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(h.x, h.y, R * 5, 0, 6.29); ctx.fill();
    // corona rays
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * 6.283 + t * .05 * (i % 2 ? 1 : -1), L = R * (1.8 + .6 * Math.sin(t * 1.3 + i * 2.1));
      const rg = ctx.createLinearGradient(h.x, h.y, h.x + Math.cos(a) * L, h.y + Math.sin(a) * L);
      rg.addColorStop(0, 'rgba(190,225,255,.35)'); rg.addColorStop(1, 'rgba(190,225,255,0)');
      ctx.strokeStyle = rg; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(h.x + Math.cos(a) * L, h.y + Math.sin(a) * L); ctx.stroke();
    }
    // swirling accretion disk
    for (let i = 0; i < 70; i++) {
      const a = i * 2.39996 + t * (.6 + (i % 5) * .08), d = R * (1.1 + (i * 37 % 100) / 100 * 1.1);
      ctx.fillStyle = `rgba(170,215,255,${.25 + .35 * ((i * 13) % 10) / 10})`;
      ctx.fillRect(h.x + Math.cos(a) * d, h.y + Math.sin(a) * d * .9, 1.6, 1.6);
    }
    ctx.globalCompositeOperation = 'source-over';
    const core = ctx.createRadialGradient(h.x - R * .3, h.y - R * .35, 1, h.x, h.y, R);
    core.addColorStop(0, '#ffffff'); core.addColorStop(.3, '#d6ecff'); core.addColorStop(.75, '#6fb6ff'); core.addColorStop(1, 'rgba(80,140,255,.6)');
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(h.x, h.y, R, 0, 6.29); ctx.fill();
    ctx.strokeStyle = 'rgba(220,240,255,.8)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(h.x, h.y, R, 0, 6.29); ctx.stroke();
    if (this.hover === 'hub') { ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.setLineDash([2, 5]); ctx.beginPath(); ctx.arc(h.x, h.y, R + 10, t, t + 6.283); ctx.stroke(); ctx.setLineDash([]); }
    ctx.textAlign = 'center'; ctx.fillStyle = '#0a1240';
    ctx.font = '600 15px -apple-system, system-ui, sans-serif'; ctx.fillText(`${Math.round(h.tps)}`, h.x, h.y + 1);
    ctx.font = '500 9px -apple-system, system-ui, sans-serif'; ctx.fillText('tok/s', h.x, h.y + 12);
    ctx.fillStyle = 'rgba(220,230,255,.9)'; ctx.font = '300 13px -apple-system, system-ui, sans-serif';
    ctx.fillText(h.ready ? `${fmtTok(h.tok)} tokens today` : 'Reading sessions…', h.x, h.y + R + 44);
    ctx.fillStyle = 'rgba(160,170,220,.75)'; ctx.font = '300 11px -apple-system, system-ui, sans-serif';
    ctx.fillText(`${h.working || 0} / ${h.count}  active`.split('').join(String.fromCharCode(8202)), h.x, h.y + R + 60);
  }

  drawMote(n, dt) {
    const ctx = this.ctx, s = n.s, t = this.time;
    const alive = n.dying ? Math.max(0, 1 - (t - n.dying) / 2.5) : Math.min(1, (t - n.born) / 1.2);
    let R = this.nodeRadius(n) * (.5 + .5 * alive) * (1 + n.swell * .12);
    let col = sessionColor(s);
    const energy = { working: 1, idle: .62, quiet: .7, waiting: .8, error: .9 }[s.health] ?? .5;
    if (s.health === 'working') R *= 1 + .035 * Math.sin(t * 5 + n.seed * 9);
    n.phase *= Math.pow(.1, dt); n.flash *= Math.pow(.25, dt);
    n.spin += dt * (s.health === 'working' ? .9 : .15) * (n.seed > .5 ? 1 : -1);

    ctx.globalAlpha = alive * (.55 + .45 * energy);
    // outer glow
    ctx.globalCompositeOperation = 'lighter';
    const gs = glowSprite(s.health === 'error' ? '#ff4d6a' : col), G = R * (3 + n.phase * .6 + n.flash * 2);
    ctx.globalAlpha = alive * (.18 + .25 * energy + n.flash * .4);
    ctx.drawImage(gs, n.x - G, n.y - G, G * 2, G * 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alive * (.55 + .45 * energy);
    // translucent body (rotating sprite)
    ctx.save(); ctx.translate(n.x, n.y); ctx.rotate(n.spin);
    ctx.drawImage(moteSprite(col), -R, -R, R * 2, R * 2);
    ctx.restore();
    // swirling interior particles
    ctx.globalCompositeOperation = 'lighter';
    for (const p of n.inner) {
      p.a += p.sp * dt * (s.health === 'working' ? 2.4 : .5) * (1 + n.swell * 2);
      const d = p.d * R * (1 + n.swell * .08 * Math.sin(t * 6 + p.a));
      ctx.fillStyle = hexA(mix(col, .5), .5 + .4 * energy);
      ctx.beginPath(); ctx.arc(n.x + Math.cos(p.a) * d, n.y + Math.sin(p.a) * d, p.sz * (R / 30), 0, 6.29); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    // glowing, shimmering rim (the reference's neon border) + a faint outer halo ring
    const shim = .75 + .25 * Math.sin(t * 3.1 + n.seed * 17) * Math.sin(t * 1.7 + n.seed * 5);
    const rimCol = s.health === 'error' && Math.random() > .3 ? '#ff6b7d' : mix(col, .45);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = rimCol; ctx.shadowBlur = (14 + 10 * energy) * shim + n.flash * 20;
    ctx.strokeStyle = hexA(rimCol, .75 + .25 * energy); ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(n.x, n.y, R, 0, 6.29); ctx.stroke();
    ctx.shadowBlur = 0; ctx.strokeStyle = `rgba(255,255,255,${.35 * shim})`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(n.x, n.y, R - .5, 0, 6.29); ctx.stroke();
    const sa = t * (s.health === 'working' ? 1.6 : .5) * (n.seed > .5 ? 1 : -1) + n.seed * 9;   // travelling glint
    ctx.strokeStyle = `rgba(255,255,255,${.55 * shim})`; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(n.x, n.y, R, sa, sa + .55); ctx.stroke();
    ctx.strokeStyle = hexA(col, .18 + .1 * shim); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(n.x, n.y, R + 13, 0, 6.29); ctx.stroke();
    ctx.restore();
    // attention pulse
    if (s.health === 'waiting' || s.health === 'quiet') {
      const k = (t * .8) % 1; ctx.strokeStyle = `rgba(255,207,107,${(1 - k) * .7})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(n.x, n.y, R + 4 + k * 26, 0, 6.29); ctx.stroke();
    }
    // context gauge (thin outer arc)
    const ctxPct = s.ctxMax ? Math.min(1, s.ctx / s.ctxMax) : 0;
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(n.x, n.y, R + 7, 0, 6.29); ctx.stroke();
    ctx.strokeStyle = ctxPct > .85 ? '#ff6b7d' : ctxPct > .6 ? '#ffcf6b' : hexA(mix(col, .3), .9);
    ctx.beginPath(); ctx.arc(n.x, n.y, R + 7, -Math.PI / 2, -Math.PI / 2 + ctxPct * 6.283); ctx.stroke();
    // sub-agents = small motes in orbit
    const subs = Math.min(8, s.subagents || 0);
    for (let i = 0; i < subs; i++) {
      const a = t * 1.3 + i / subs * 6.283 + n.seed * 5, rr = R + 22, r = 4.5;
      ctx.drawImage(moteSprite(col, false), n.x + Math.cos(a) * rr - r, n.y + Math.sin(a) * rr - r, r * 2, r * 2);
    }
    if (this.selected === n.sid) {
      ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1; ctx.setLineDash([2, 5]);
      ctx.beginPath(); ctx.arc(n.x, n.y, R + 15, t * .6, t * .6 + 6.283); ctx.stroke(); ctx.setLineDash([]);
    }
    // label pill (dark glass, like the reference's node tags)
    ctx.globalAlpha = alive * (.85 + .15 * n.swell);
    const name = s.name.length > 30 ? s.name.slice(0, 29) + '…' : s.name;
    const l2 = `${(s.model || '—').replace('claude-', '')}  ·  ${fmtTok(s.todayTok)}`;
    const l3 = (s.health === 'working' ? `working · ${Math.round(s.tps)} tok/s` : s.health) + (s.owner ? '  ·  in-app' : '');
    ctx.font = '600 12px -apple-system, system-ui, sans-serif, "Apple SD Gothic Neo"'; const w1 = ctx.measureText(name).width;
    ctx.font = '400 10.5px -apple-system, system-ui, sans-serif'; const pw = Math.max(w1, ctx.measureText(l2).width, ctx.measureText(l3).width) + 22;
    const py = n.y + R + 20, ph = 46;
    ctx.fillStyle = 'rgba(12,12,40,.72)'; ctx.strokeStyle = hexA(mix(col, .3), .35 + .25 * n.swell); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(n.x - pw / 2, py, pw, ph, 8); ctx.fill(); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = '600 12px -apple-system, system-ui, sans-serif, "Apple SD Gothic Neo"'; ctx.fillStyle = '#f2f3ff'; ctx.fillText(name, n.x, py + 15);
    ctx.font = '400 10.5px -apple-system, system-ui, sans-serif'; ctx.fillStyle = hexA(mix(col, .35), .95); ctx.fillText(l2, n.x, py + 29);
    ctx.fillStyle = HEALTH_COLOR[s.health] || '#9fb4d8'; ctx.fillText(l3, n.x, py + 41);
    ctx.globalAlpha = 1;
  }

  drawFx(dt) {
    const ctx = this.ctx;
    this.fx = this.fx.filter(f => {
      f.t += dt;
      if (f.kind === 'absorb') {          // mote drawn into the cursor
        const k = Math.min(1, f.t / .35), tx = f.to ? f.to.x : this.cursor.x, ty = f.to ? f.to.y : this.cursor.y; const x = f.x + (tx - f.x) * k, y = f.y + (ty - f.y) * k;
        ctx.globalAlpha = 1 - k; const S = f.r * BUBBLE_SPRITE_K * (1 - k) + .1; ctx.drawImage(bubbleSprite(f.color), x - S, y - S, S * 2, S * 2); ctx.globalAlpha = 1;
        return k < 1;
      }
      if (f.kind === 'ko') {              // a rival was absorbed
        const k = f.t / 1.6; ctx.strokeStyle = hexA(f.color, (1 - k) * .9); ctx.lineWidth = 2;
        for (let i = 0; i < 2; i++) { ctx.beginPath(); ctx.arc(f.x, f.y, 10 + k * (70 + i * 40), 0, 6.29); ctx.stroke(); }
        ctx.fillStyle = hexA(f.color, 1 - k); ctx.font = '500 12px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(f.by === 'you' ? `${f.name} absorbed!` : `${f.by} ate ${f.name}`, f.x, f.y - 20 - k * 16); return k < 1;
      }
      if (f.kind === 'eaten') {           // the cursor mote was swallowed
        const k = f.t / 1.2; ctx.strokeStyle = `rgba(255,92,108,${(1 - k) * .8})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(f.x, f.y, 6 + k * 50, 0, 6.29); ctx.stroke();
        ctx.fillStyle = `rgba(255,170,180,${1 - k})`; ctx.font = '300 11px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('A B S O R B E D', f.x, f.y - 16 - k * 10); return k < 1;
      }
      if (f.kind === 'wave') {            // ejection shockwave
        const k = f.t / .7; ctx.strokeStyle = `rgba(190,220,255,${(1 - k) * .55})`; ctx.lineWidth = 2 * (1 - k) + .5;
        ctx.beginPath(); ctx.arc(f.x, f.y, 8 + k * 160, 0, 6.29); ctx.stroke(); return k < 1;
      }
      return false;
    });
  }

  drawCursor(dt, spd) {
    const c = this.cursor, ctx = this.ctx; if (!c.in) return;
    if (spd > 60 && Math.random() < Math.min(1, spd / 600)) {     // propulsion trail
      const a = Math.atan2(-c.vy, -c.vx) + (Math.random() - .5) * .7, sp = 40 + Math.random() * 60;
      this.matter.push({ x: c.x + Math.cos(a) * c.r, y: c.y + Math.sin(a) * c.r, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: .8 + Math.random(), color: '#9fd8ff', life: 1.2, free: true });
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = .35; ctx.drawImage(glowSprite('#7cc4ff'), c.x - c.r * 2.6, c.y - c.r * 2.6, c.r * 5.2, c.r * 5.2); ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(moteSprite('#7cc4ff', false), c.x - c.r, c.y - c.r, c.r * 2, c.r * 2);
    ctx.strokeStyle = 'rgba(210,235,255,.85)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, 6.29); ctx.stroke();
  }

  // canvas pixel ratio: the iPhone's 3× screen renders at 2× (less than half the pixels, hardly visible on a moving scene)
  // View ▸ Mesh toggles (main.js MESH_ITEMS → app.js applyHidden → this.hideFx)
  off(k) { return !!(this.hideFx && this.hideFx[k]); }

  // 2026-10-29: the Mac draws the mesh at 1.5× on Retina (44 % fewer pixels than 2× for every full-window glow / blend
  // pass); the iPhone stays at 2×
  dpr() { const d = devicePixelRatio || 1; return this.lite ? Math.min(2, d) : Math.min(1.5, d); }

  hit(e) {
    const { x, y } = this.toWorld(e);
    if (Math.hypot(x - this.hub.x, y - this.hub.y) < this.motherRadius()) return 'hub';
    // overlapping bubbles: the one whose centre is nearest (relative to its size) wins, not the first in the list
    let best = null, bd = Infinity;
    for (const n of this.nodes.values()) {
      if (n.dying || n.eaten || ((n.gscale ?? 1) < .45 && !n.moon)) continue; const R = this.nodeRadius(n) * (n.gscale ?? 1), d = Math.hypot(x - n.x, y - n.y);
      if (d < R + (this.lite ? 16 : 12) && d / R < bd) { bd = d / R; best = n.sid; }
    }
    return best || (this.hitPortal ? this.hitPortal({ x, y }) : null);
  }
  move(e) {
    const p = this.toWorld(e); this.cursor.x = p.x; this.cursor.y = p.y;
    if (this.drag) return;
    if (this.cursor.px < -900) { this.cursor.px = this.cursor.x; this.cursor.py = this.cursor.y; }
    this.cursor.in = true;
    this.probeHover = !this.lite && !!(this.hitProbe && this.hitProbe(p));       // the probe droid sits on top of everything (no hover on the phone)
    if (this.probeHover) { this.hover = null; this.ringHover = false; this.c.style.cursor = 'pointer'; return; }
    this.hover = this.hit(e); this.ringHover = !this.hover && this.onRing(p);
    this.c.style.cursor = this.hover && this.hover !== 'hub' ? 'grab' : this.hover === 'hub' ? 'grab' : this.ringHover || (this.objHit && this.objHit(p)) ? 'grab' : '';
  }
  down(e) {
    if (e.button === 0 && this.hitProbe && this.hitProbe(this.toWorld(e))) return this.probeGrabStart ? this.probeGrabStart(e) : this.probeMenu(e.clientX, e.clientY);   // click the probe: its commands · drag it: haul it about (probe-life.js)
    const h = this.hit(e);
    // the mother star (2026-11-02): press and drag = spin it with the whole orbit system (like grabbing the ring);
    // a plain click = Broadcast. Decided on release / after a 5 px move (window mousemove / mouseup below).
    if (h === 'hub') { if (e.button !== 0) return this.onHub(); this.hubPress = { x0: e.clientX, y0: e.clientY }; this.c.style.cursor = 'grab'; return; }
    if (h && h.startsWith('grp:')) { if (e.button === 0) this.dragStart(e, h); return; }   // a group's main bubble: click opens / closes it, drag moves the group
    if (h) { if (e.button === 0) this.dragStart(e, h); return; }   // click = select, drag = move its orbit
    if (e.button === 0 && this.objDragStart && this.objDragStart(e)) return;   // the Endurance / the black hole: drag to turn / tilt
    if (e.button === 0 && this.onRing(this.toWorld(e))) {           // grab the outer orbit ring = spin the whole system
      const a = this.ringAngle(this.toWorld(e));
      this.spinDrag = { x: e.clientX, y: e.clientY, near: Math.sin(a) >= 0, t: performance.now(), v: 0 }; this.sysVel = 0; this.c.style.cursor = 'grabbing'; return;
    }
    if (e.button === 0) this.pan = { x0: e.clientX, y0: e.clientY, tx: this.cam.ttx, ty: this.cam.tty, moved: false, e };   // drag empty space = pan
  }

  // ---- spinning the whole system like a globe: drag along the outer orbit ring, let go and it coasts ----
  onRing(p) {
    if (this.compact || !this.orbitShape) return false;
    const { rx, k } = this.orbitShape(), rn = Math.hypot(p.x - this.hub.x, (p.y - this.hub.y) / k) / rx;
    return rn > .88 && rn < 1.25;
  }
  ringAngle(p) { const { k } = this.orbitShape(); return Math.atan2((p.y - this.hub.y) / k, p.x - this.hub.x); }
  // like a globe: sideways = spin (the half you grabbed follows the pointer), up/down = tilt the plane (±15°)
  spinMove(e) {
    const s = this.spinDrag, now = performance.now(), dt = Math.max(.001, (now - s.t) / 1000);
    const dx = (e.clientX - s.x) / this.cam.s, dy = (e.clientY - s.y) / this.cam.s, { rx } = this.orbitShape();
    const d = (s.near ? -1 : 1) * dx / Math.max(80, rx);
    this.sysRot = (this.sysRot || 0) + d; s.v = s.v * .6 + (d / dt) * .4;
    this.sysTilt = Math.max(-.2618, Math.min(.2618, (this.sysTilt || 0) + dy * .004));   // ±15°
    s.x = e.clientX; s.y = e.clientY; s.t = now; this.lastInput = now;
  }
  spinEnd() {
    const s = this.spinDrag; this.spinDrag = null; this.c.style.cursor = this.ringHover ? 'grab' : '';
    this.sysVel = performance.now() - s.t < 120 ? Math.max(-3, Math.min(3, s.v)) : 0;   // flicked → coasts; held still → stops
    try { localStorage.setItem('mesh.sysRot', String(this.sysRot || 0)); localStorage.setItem('mesh.sysTilt', String(this.sysTilt || 0)); } catch { }
  }

  // a click (no drag) on empty space: Osmos-style ejection burst + shockwave, and deselect
  burst(e) {
    const { x, y } = this.toWorld(e);
    this.fx.push({ kind: 'wave', x, y, t: 0 });
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * 6.283, sp = 80 + Math.random() * 200;
      this.matter.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: .8 + Math.random() * 1.6, color: '#9fd8ff', life: 1.4, free: true });
    }
    const push = (o, k) => { const dx = o.x - x, dy = o.y - y, d = Math.hypot(dx, dy); if (d < 220 && d > 1) { o.vx += dx / d * (1 - d / 220) * k; o.vy += dy / d * (1 - d / 220) * k; } };
    for (const m of this.ambient) push(m, 260);
    this.onSelect(null);
  }
}
window.Mesh = Mesh;
window.FAMILY_COLOR = FAMILY_COLOR;
