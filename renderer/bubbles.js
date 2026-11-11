// Session bubbles + the bubbles they produce.
//  • Every session slowly orbits the mother bubble. Drag one anywhere: the drop point becomes
//    its orbit (saved per session). Farther orbits turn slower, closer ones faster (Kepler-ish).
//    Double-click a session bubble to send it back to its automatic slot.
//  • Each session is tied to the mother by glowing strands: more strands, and an older star
//    colour, the harder it works (drawLinks).
const ORBIT_LAP = 900;
const MAP_M = .5;                          // the map reaches half a window past each edge (2× the window)
// load colour 0…1: light blue → yellow → orange → red
const LOAD_RAMP = [[0, [150, 210, 255]], [.4, [255, 236, 110]], [.7, [255, 152, 44]], [1, [236, 52, 40]]];
function loadColor(x) {
  for (let i = 1; i < LOAD_RAMP.length; i++) if (x <= LOAD_RAMP[i][0]) {
    const [a, ca] = LOAD_RAMP[i - 1], [b, cb] = LOAD_RAMP[i], k = (x - a) / (b - a);
    return ca.map((v, j) => Math.round(v + (cb[j] - v) * k));
  }
  return LOAD_RAMP[LOAD_RAMP.length - 1][1];
}                    // seconds per lap for an automatic slot (≈ 15 min)
const PIN_KEY = 'mesh.orbits';

function bubbleSprite(color) {
  const key = 'b' + color; if (spriteCache.has(key)) return spriteCache.get(key);
  const S = 96, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'), C = S / 2, R = S * .31;         // body radius; the rest is glow
  const glow = x.createRadialGradient(C, C, R * .7, C, C, S / 2);
  glow.addColorStop(0, hexA(color, 0)); glow.addColorStop(.28, hexA(color, .55)); glow.addColorStop(.42, hexA(color, .22)); glow.addColorStop(1, hexA(color, 0));
  x.fillStyle = glow; x.fillRect(0, 0, S, S);
  const body = x.createRadialGradient(C, C, 0, C, C, R);
  body.addColorStop(0, hexA(color, .08)); body.addColorStop(.7, hexA(color, .16)); body.addColorStop(.9, hexA(mix(color, .55), .85)); body.addColorStop(1, hexA(mix(color, .8), 1));
  x.fillStyle = body; x.beginPath(); x.arc(C, C, R, 0, 6.29); x.fill();
  const spec = x.createRadialGradient(C - R * .4, C - R * .45, 0, C - R * .4, C - R * .45, R * .5);
  spec.addColorStop(0, 'rgba(255,255,255,.55)'); spec.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = spec; x.beginPath(); x.arc(C, C, R, 0, 6.29); x.fill();
  spriteCache.set(key, c); return c;
}
const BUBBLE_SPRITE_K = 1 / .31;          // sprite size / body radius

Object.assign(Mesh.prototype, {
  // ---------------- orbits ----------------
  loadOrbits() { if (!this.orbits) { try { this.orbits = JSON.parse(localStorage.getItem(PIN_KEY)) || {}; } catch { this.orbits = {}; } } return this.orbits; },
  saveOrbits() { try { localStorage.setItem(PIN_KEY, JSON.stringify(this.orbits)); } catch { } },
  orbitShape() {                          // the automatic orbit ellipse (also the speed reference)
    const MR = this.motherRadius();
    // as wide as the mesh allows (2026-10-21: "much farther out, but the bubble and its label fully in view"):
    // sideways half a label (~110 px) from the edge; vertically the bubble's glow ring above and its label pill below
    const hx = this.hub.x, hy = this.hub.y;
    const rx = this.compact ? Math.max(MR * 2.4, this.w / 2 - 70) : Math.max(MR + 130, Math.min(hx, this.w - hx) - 118);
    const ry = this.compact ? Math.max(MR * 1.8, this.h / 2 - 46) : Math.max(MR + 100, Math.min(hy - 84, this.h - hy - 150));
    // k = sin(viewing elevation). Dragging the ring up/down tilts it up to ±15° from the fitted view; past edge-on
    // it flips (seen from below: k < 0, the near half on top). Never exactly edge-on (k would be 0).
    if (this.sysTilt == null) { try { this.sysTilt = Math.max(-.2618, Math.min(.2618, +localStorage.getItem('mesh.sysTilt') || 0)); } catch { this.sysTilt = 0; } }
    const e = Math.asin(Math.min(.95, ry / rx)) + this.sysTilt, k0 = Math.sin(e), k = Math.abs(k0) < .06 ? (k0 < 0 ? -.06 : .06) : k0;
    return { rx, ry, k };
  },
  // keep a session's whole footprint (glow ring above, label pill + hint line below) inside the mesh
  // window at any window/dock size — orbits that would leave it slide along the edge instead
  // A session you placed by hand keeps the area that was on screen when you dropped it (stored relative to
  // the star), so it stays put after zooming out/panning and dropping it outside the original window box.
  fitInView(n, p) {
    const box = null;                     // 2026-10-21: no more off-window areas — a session dropped while zoomed out flew out of reach
    const R = this.nodeRadius(n) * 1.12, half = Math.max(R + 20, (n.labelW || 200) / 2) + 8;
    const top = this.compact ? R + 6 : R + 22, bottom = this.compact ? R + 8 + 19 + 8 : R + 22 + 46 + 10 + 26;   // ring | label gap + pill + pad + #meshHint
    const hx = this.hub.x, hy = this.hub.y;
    // the map is twice the window (half a window beyond each edge, see MAP_M / clampCam): hand-placed sessions may
    // sit anywhere on it; automatic orbits never leave the window anyway
    const mx = this.compact ? 0 : MAP_M * this.w, my = this.compact ? 0 : MAP_M * this.h;
    const x0 = -mx + half, x1 = this.w + mx - half;
    const y0 = -my + top, y1 = this.h + my - bottom;
    const cx = v => x1 > x0 ? Math.min(x1, Math.max(x0, v)) : this.w / 2;
    let x = cx(p.x); const y = y1 > y0 ? Math.min(y1, Math.max(y0, p.y)) : (y0 + y1) / 2;
    // (2026-10-28: no more sliding sideways out of the mother's column — a bubble passes behind the star on the far side
    // and in front of it on the near side, as it should; the shove kicked every bubble crossing the column during a spin)
    return { x, y };
  },
  // screen box of the mother bubble + its usage card + "$ today" line (see drawMotherInfo)
  motherBox() {
    const R = this.motherRadius(), L = (this.hub.usage && this.hub.usage.limits) || [];
    if (this.compact) return { x0: this.hub.x - R * 1.22, x1: this.hub.x + R * 1.22, y0: this.hub.y - R * 1.22, y1: this.hub.y + R * 1.22 };
    const cardH = 22 + Math.max(1, L.length) * 24, hw = Math.max(R * 1.22, 107) + 4;
    return { x0: this.hub.x - hw, x1: this.hub.x + hw, y0: this.hub.y - R * 1.22, y1: this.hub.y + R * 1.22 + 8 + cardH + 24 };
  },
  // mother sits at the centre unless that would push its usage card below the mesh (short window/tall dock)
  motherY() {
    if (this.compact) return this.h / 2;
    const R = this.motherRadius(), below = R * 1.22 + 8 + (22 + 3 * 24) + 24 + 30;   // card + today line + #meshHint
    return Math.max(R * 1.22 + 6, Math.min(this.h / 2, this.h - below));
  },
  // the widest orbit whose ellipse still fits on the map (2× the window; the window itself in compact mode)
  maxOrbit() {
    const sh = this.orbitShape(), hx = this.hub.x, hy = this.hub.y, m = this.compact ? 30 : 60;
    const mx = this.compact ? 0 : MAP_M * this.w, my = this.compact ? 0 : MAP_M * this.h;
    const xr = Math.min(hx, this.w - hx) + mx - m, yr = (Math.min(hy, this.h - hy) + my - m) / Math.max(.06, Math.abs(sh.k));
    return Math.max(sh.rx, Math.min(xr, yr));
  },
  omegaAt(rx) {                           // rad/s; reference speed at the automatic orbit, ∝ r^-1.5
    const ref = this.orbitShape().rx, w0 = 6.283 / ORBIT_LAP;
    return w0 * Math.min(4, Math.max(.2, Math.pow(ref / Math.max(20, rx), 1.5)));
  },
  orbitPos(o) {                           // o = { rx, a0, t0, auto? } — angle advances with wall-clock time
    if (this.sysRot == null) { try { this.sysRot = +localStorage.getItem('mesh.sysRot') || 0; } catch { this.sysRot = 0; } }
    const sh = this.orbitShape(), rx = o.auto ? sh.rx : Math.min(o.rx, this.maxOrbit() * (o.far || 1)), a = o.a0 + this.omegaAt(rx) * (Date.now() - o.t0) / 1000 + this.sysRot;   // + the whole system's turn (ring drag)
    // z: depth on the tilted orbit plane (-1 = far side, behind the star; +1 = near side, toward you)
    // o.tilt: this orbit's own inclination (⌘-drag the session), rolls its ellipse about the star, ±15°
    const ex = Math.cos(a) * rx, ey = Math.sin(a) * rx * sh.k, ct = Math.cos(o.tilt || 0), st = Math.sin(o.tilt || 0);
    return { x: this.hub.x + ex * ct - ey * st, y: this.hub.y + ex * st + ey * ct, z: Math.sin(a) };
  },
  // a new (or released) session gets its own automatic orbit in the widest free gap — once.
  // Sessions never get re-slotted when others arrive, leave or are dragged.
  autoOrbit(n, live) {
    const sh = this.orbitShape(), orb = this.loadOrbits(), now = Date.now();
    const angs = live.filter(o => o !== n && orb[o.sid] && !o.moon).map(o => { const p = this.orbitPos(orb[o.sid]); return Math.atan2((p.y - this.hub.y) / sh.k, p.x - this.hub.x); });
    let best = -Math.PI / 2, bestGap = -1;
    for (let i = 0; i < 72; i++) {
      const a = -Math.PI / 2 + i / 72 * 6.283;
      const gap = angs.length ? Math.min(...angs.map(b => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))))) : 9;
      if (gap > bestGap + 1e-6) { bestGap = gap; best = a; }
    }
    orb[n.sid] = { auto: true, rx: sh.rx, a0: best - (this.sysRot || 0), t0: now }; this.saveOrbits();   // a0 is relative to the system's turn
  },
  dropOrbit(n) {                          // turn the drop point into an orbit on the same ellipse family
    const sh = this.orbitShape(), tilt = (this.loadOrbits()[n.sid] || {}).tilt || 0, ct = Math.cos(tilt), st = Math.sin(tilt);
    const ux = n.x - this.hub.x, uy = n.y - this.hub.y, dx = ux * ct + uy * st, dy = (-ux * st + uy * ct) / sh.k;   // into the orbit's own frame
    const far = n.gslot ? 2 : 1;                                   // a group may sit twice as far out as a session (user ask 2026-10-24)
    const rx = Math.min(this.maxOrbit() * far, Math.max(this.motherRadius() + this.nodeRadius(n) + 20, Math.hypot(dx, dy)));
    const v = this.view ? this.view() : { x0: 0, y0: 0, x1: this.w, y1: this.h }, hx = this.hub.x, hy = this.hub.y;
    const R = this.nodeRadius(n) * 1.12, px = Math.max(R + 20, (n.labelW || 200) / 2) + 10, top = R + 24, bot = R + 120;   // bubble + its label
    const box = { x0: Math.min(0, v.x0, n.x - px) - hx, x1: Math.max(this.w, v.x1, n.x + px) - hx,       // what was visible at the drop,
                  y0: Math.min(0, v.y0, n.y - top) - hy, y1: Math.max(this.h, v.y1, n.y + bot) - hy };   // always including the drop point
    this.loadOrbits()[n.sid] = { rx, a0: Math.atan2(dy, dx) - (this.sysRot || 0), t0: Date.now(), box, tilt, ...(far > 1 ? { far } : {}) }; this.saveOrbits();
  },

  // ---------------- session motion (shared by both renderers) ----------------
  // iPhone: keep bubbles from piling up. Each bubble + its name tag below is a box; two boxes that overlap are pushed
  // apart along the shorter way out (half each, the dragged one stays put), a few passes per frame
  separate(L) {
    const TAG = 16 + 19, box = n => { const R = this.nodeRadius(n); return { hw: Math.max(R, (n.labelW || 60) / 2) + 5, hh: R + TAG / 2 + 5, cy: n.y + TAG / 2 }; };
    for (let it = 0; it < 3; it++) for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j], A = box(a), B = box(b);
      let dx = b.x - a.x, dy = B.cy - A.cy;
      const ox = A.hw + B.hw - Math.abs(dx), oy = A.hh + B.hh - Math.abs(dy);
      if (ox <= 0 || oy <= 0) continue;
      if (!dx && !dy) dx = a.seed - b.seed || .1;
      const wa = a.dragging ? 0 : b.dragging ? 1 : .5, wb = 1 - wa;
      if (ox < oy) { const s = Math.sign(dx) || 1; a.x -= s * ox * wa; b.x += s * ox * wb; a.vx *= .8; b.vx *= .8; }
      else { const s = Math.sign(dy) || 1; a.y -= s * oy * wa; b.y += s * oy * wb; a.vy *= .8; b.vy *= .8; }
    }
  },

  stepSessions(dt, realDt, cspd) {
    const orb = this.loadOrbits();
    // while the system is spun or tilted (spin band drag, the coast after a flick, a tilt) every bubble rides the orbit
    // plane rigidly — no spring lag — the way a group's portal does; the spring takes over again a moment after
    const live = [...this.nodes.values()].filter(n => !n.dying);
    // (2026-10-28: a rigid transform, not a snap — every bubble's current position and motion are turned round the star
    // in the plane by exactly the system's turn, so a bubble pushed off its orbit point stays pushed, and its depth
    // follows its position at once instead of easing after it)
    { const sh = this.orbitShape(), rot = this.sysRot || 0, hx = this.hub.x, hy = this.hub.y;
      if (this.lastSysRot != null && (rot !== this.lastSysRot || sh.k !== this.lastSysK)) {
        this.sysTurnAt = this.time;
        const d = rot - this.lastSysRot, c = Math.cos(d), sn = Math.sin(d), k0 = this.lastSysK, k = sh.k;
        for (const n of live) {
          if (n.dragging || n.gslot || n.eaten) continue;                       // dragged: under your hand; satellites: their portal moves them
          const u = n.x - hx, v = (n.y - hy) / k0; n.x = hx + u * c - v * sn; n.y = hy + (u * sn + v * c) * k;
          const vu = n.vx, vv = n.vy / k0; n.vx = vu * c - vv * sn; n.vy = (vu * sn + vv * c) * k;
        }
      }
      this.lastSysRot = rot; this.lastSysK = sh.k; }
    const turning = this.time - (this.sysTurnAt ?? -9) < .25;
    for (const n of live) if (!orb[n.sid]) this.autoOrbit(n, live);
    if (this.groupPass) this.groupPass(live, orb, realDt);           // grouped sessions: slots inside their portal (portal.js)
    // recency: the most recently active session → 1, the stalest → 0 (rank by time since last transcript write)
    // prominence = 65% how often it runs (replies in the last 24 h, recent weighted) + 35% how recently it ran
    const ages = [...new Set(live.map(n => Math.round((n.s.sinceWrite ?? 1e9) / 5)))].sort((a, b) => a - b);   // 5 s buckets → ties share a rank
    const fmax = Math.max(1, ...live.map(n => n.s.freq || 0));
    live.forEach(n => {
      const i = ages.indexOf(Math.round((n.s.sinceWrite ?? 1e9) / 5)), recency = ages.length > 1 ? 1 - i / (ages.length - 1) : 1;
      const often = Math.sqrt((n.s.freq || 0) / fmax), target = .65 * often + .35 * recency;
      n.rec = (n.rec ?? target) + (target - (n.rec ?? target)) * Math.min(1, realDt * 2);
    });
    // focus: the session whose terminal tab is the one you're typing in (dock below the mesh)
    const at = typeof activeTerm !== 'undefined' && document.body.dataset.view !== 'mesh' ? activeTerm : null;   // only while the terminal dock is visible
    live.forEach(n => { const f = at && n.s.owner === at ? 1 : 0; n.focus = (n.focus || 0) + (f - (n.focus || 0)) * Math.min(1, realDt * 3); });
    const F = live.find(n => n.focus > .05);
    live.forEach(n => {
      n.swell += ((this.hover === n.sid || n.dragging ? 1 : 0) - n.swell) * Math.min(1, realDt * 8);
      if (n.dragging) { n.vx = n.vy = 0; return; }
      let p = n.gslot || this.orbitPos(orb[n.sid]);
      n.z = turning ? p.z : (n.z ?? p.z) + (p.z - (n.z ?? p.z)) * Math.min(1, realDt * 2);   // (turning: depth keeps up with the position)
      if (F && n !== F) {                              // others step back from the focused session, giving it room
        const dx = p.x - F.x, dy = p.y - F.y, d = Math.hypot(dx, dy) || 1, D = this.nodeRadius(F) + this.nodeRadius(n) + 260;
        if (d < D) { const k = (D - d) * F.focus; p = { x: p.x + dx / d * k, y: p.y + dy / d * k }; }
      }
      const h = n.gslot ? p : this.fitInView(n, p);    // each session follows only its own orbit, kept on-screen (a group: its portal)
      n.vx += (h.x - n.x) * 2.2 * dt; n.vy += (h.y - n.y) * 2.2 * dt;
      const damp = Math.pow(.12, dt); n.vx *= damp; n.vy *= damp;
      n.x += n.vx * dt; n.y += n.vy * dt;
    });
    if (this.lite) this.separate(live.filter(n => !n.dying && !n.gslot));
    for (const [sid, n] of this.nodes) if (n.dying && this.time - n.dying > 2.5) this.nodes.delete(sid);
  },

    // token bubbles were removed (too costly); load now shows as strands in drawLinks
  simAmbient() { this.ambient.length = 0; },
  // shimmering, glow-rimmed bubbles
  drawBubbles(ctx, parX, parY) {
    const t = this.time;
    for (const m of this.ambient) {
      const fade = Math.min(1, (t - m.born) / .6), sh = .72 + .28 * Math.sin(t * 4.2 + m.ph) * Math.sin(t * 2.3 + m.ph * 2);
      const r = m.r * (1 + .05 * Math.sin(t * 6 + m.ph)), S = r * BUBBLE_SPRITE_K;
      ctx.globalAlpha = fade * sh;
      ctx.drawImage(bubbleSprite(m.color), m.x - S, m.y - S, S * 2, S * 2);
    }
    ctx.globalAlpha = 1;
  },

  // smoothed load 0…1 from tok/s (√ so moderate work already shows a visible bundle)
  heaviness(n) {
    const target = n.s.health === 'working' ? Math.min(1, Math.sqrt((n.s.tps || 0) / 300)) : 0;
    n.heavy = (n.heavy || 0) + (target - (n.heavy || 0)) * .04;      // eases over ~1–2 s
    // wiggle phase advances faster the harder the session works (accumulated, so speed changes stay smooth)
    const now = this.time; n.wig = (n.wig || 0) + Math.max(0, now - (n._wt ?? now)) * (.35 + 5.5 * n.heavy); n._wt = now;
    return n.heavy;
  },
  // Strand j has a fixed place in the bundle (golden-ratio spread), so new strands fan in
  // around the existing ones instead of everything shifting as the count grows.
  strandGeom(n, j, t) {
    // a grouped session's strands run to its group's bubble (it orbits that, not the star); the group bubble's to the star
    const P = n.gslot && this.portals && this.portals.get(n.s.group);
    const hub = P ? P : this.hub, MR = P ? P.Rm : this.motherRadius(), R = this.nodeRadius(n) * (n.gscale ?? 1);
    const dx = hub.x - n.x, dy = hub.y - n.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    const side = n.seed > .5 ? 1 : -1, u = j === 0 ? 0 : ((j * .6180339887 + n.seed) % 1) * 2 - 1;   // −1…1, 0 = centre line
    const rot = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
    const [sx, sy] = rot(ux, uy, u * .26), [ex, ey] = rot(-ux, -uy, -u * .13);       // a narrow bundle around the centre line
    const x0 = n.x + sx * R, y0 = n.y + sy * R, x1 = hub.x + ex * MR * 1.03, y1 = hub.y + ey * MR * 1.03;
    // the closer to the star, the straighter: the bow's share of the length eases from full at the orbit ring down to
    // ~15 % right at the star (2026-10-27)
    const ref = P ? (P.R || 120) : (this.orbitShape ? this.orbitShape().rx : 300), near = Math.max(.15, Math.min(1, (L - MR) / Math.max(1, ref - MR)));
    const bend = (side * .2 + u * .04 + .01 * Math.sin(t * (.9 + (j % 7) * .23) + n.seed * 9 + j)) * L * near;
    // most strands follow a smooth path to the star, each with its own slight random bow (a gentle
    // outward sag that grows with distance from the centre line); only ~1 in 8 squiggles
    const far = Math.abs(u), h = ((j * 7919 + Math.round(n.seed * 1e4)) % 97) / 97, squig = j > 0 && h < .125;
    const amp = squig ? L * (.005 + .012 * Math.pow(far, 1.4)) * near : 0;
    const sag = j === 0 ? 0 : (Math.sign(u || 1) * .022 * far * far + (h - .5) * .016) * L * near;
    return { x0, y0, x1, y1, mx: (x0 + x1) / 2 - uy * bend, my: (y0 + y1) / 2 + ux * bend, nx: -uy, ny: ux,
      amp, sag, squig, freq: 1.4 + h * 8, ph: h * 6.283 + (n.wig || 0) * (1 + h * 3) * (h > .06 ? 1 : -1), wobbly: j > 0 };
  },
  // point at s∈[0,1] along a strand: the quadratic curve plus its dangle/wiggle (zero at both ends)
  strandPoint(g, s) {
    const q = 1 - s, x = q * q * g.x0 + 2 * q * s * g.mx + s * s * g.x1, y = q * q * g.y0 + 2 * q * s * g.my + s * s * g.y1;
    if (!g.wobbly) return [x, y];
    const env = Math.sin(Math.PI * s), off = env * (g.sag + g.amp * Math.sin(g.freq * s * 6.283 + g.ph));
    return [x + g.nx * off, y + g.ny * off];
  },

  // Load lines: 1 strand when idle, up to 50 under heavy load, ageing young → old star colour.
  // Strand 0 is the bright main link; the rest are batched into one path per session (one stroke).
  drawLinks(ctx) {
    // Window ▸ Lines to the mother star off: the permanent line from each bubble is hidden, but the bundle of load
    // strands a session throws out while it's burning tokens still shows (fading in and out with the load)
    const linksOff = this.off('mLinks'), t = this.time, cap = 20;
    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const n of [...this.nodes.values(), ...(this.portalNodes ? this.portalNodes() : [])]) {
      if (n.dying || n.eaten || (n.gscale ?? 1) < .3) continue;   // (eaten: going into the black hole)
      const h = this.heaviness(n), N = Math.max(1, Math.round(1 + h * (cap - 1))), work = n.s.health === 'working' ? 1 : 0;
      if (linksOff && h < .02) continue;                              // off + no load: nothing
      const loadFade = linksOff ? Math.min(1, h / .12) : 1;
      const rim = (ORB_PAL[n.s.serverUses ? 'server' : n.s.family] || ORB_PAL.other).rim;
      const G = [];
      for (let j = linksOff ? 1 : 0; j < N; j++) {                // (off: no main link, j = 0)
        const g = this.strandGeom(n, j, t), jit = ((j * 9301 + Math.round(n.seed * 1e4)) % 233) / 233 - .5;   // per-strand variety
        const c = loadColor(Math.min(1, Math.max(0, h + jit * .28))), w = (j === 0 ? 1.6 : 1) * (.7 + h * 2.6) * (1 + jit * .5);
        const vis = Math.min(1, N - j) * loadFade;                    // the newest strand fades in
        const steps = g.squig ? Math.ceil(g.freq * 12) : 16, path = new Path2D(); path.moveTo(g.x0, g.y0);
        for (let i = 1; i <= steps; i++) { const [x, y] = this.strandPoint(g, i / steps); path.lineTo(x, y); }
        if (j === 0) {                                                 // main link: from the orb's rim colour into the load colour
          const grad = ctx.createLinearGradient(g.x0, g.y0, g.x1, g.y1); grad.addColorStop(0, hexA(rim, .9)); grad.addColorStop(.3, `rgba(${c},.95)`); grad.addColorStop(1, `rgba(${c},1)`);
          ctx.strokeStyle = grad;
        } else ctx.strokeStyle = `rgb(${c})`;
        ctx.globalAlpha = (.08 + .07 * work) * vis * .5; ctx.lineWidth = w * 3.2; ctx.stroke(path);        // soft glow
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = (j === 0 ? .9 : .6 + .25 * h) * vis * .5; ctx.lineWidth = w; ctx.stroke(path);    // true-colour core
        ctx.globalCompositeOperation = 'lighter';
        G.push({ g, c });
      }
      if (work) {                                                      // light pulses run down every 3rd strand
        G.filter((_, i) => i % 3 === 0).slice(0, 8).forEach(({ g, c }, i) => {
          const kk = (t * (.3 + h * .9) + i * .37 + n.seed) % 1, sz = 5 + 4 * h, [px, py] = this.strandPoint(g, kk);
          ctx.globalAlpha = (.55 + .4 * h) * .5 * loadFade; ctx.drawImage(glowSprite('#' + c.map(v => v.toString(16).padStart(2, '0')).join('')), px - sz, py - sz, sz * 2, sz * 2);
        });
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  },

  // ---------------- drag & drop ----------------
  dragStart(e, sid) {
    // a grouped session drags its whole portal: the group's first member is the one whose orbit moves
    const a = this.groupAnchor ? this.groupAnchor(sid) : sid, an = this.nodes.get(a), pn = sid.startsWith('grp:') ? this.portals.get(sid.slice(4)).node : this.nodes.get(sid);
    this.drag = { sid: a, pick: sid, dx: an && pn ? an.x - pn.x : 0, dy: an && pn ? an.y - pn.y : 0, x0: e.clientX, y0: e.clientY, moved: false, held: false, tilt: e.metaKey, ly: e.clientY };
    clearTimeout(this.holdTimer);                                  // press-and-hold (no movement) → details dropdown
    this.holdTimer = setTimeout(() => { const d = this.drag; if (d && !d.moved && this.onHold && !d.pick.startsWith('grp:')) { d.held = true; this.onHold(d.pick, d.x0, d.y0); } }, 520);
  },
  dragMove(e) {
    const d = this.drag; if (!d) return false;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > (d.held ? 8 : 4)) {   // moving after a hold still drags
      d.moved = true; clearTimeout(this.holdTimer);
      if (d.held && typeof closeHoldCard === 'function') closeHoldCard();
    }
    const n = this.nodes.get(d.sid);
    if (d.tilt) {                                                  // ⌘-drag: tilt this session's orbit; the bubble follows the pointer up/down
      const o = this.loadOrbits()[d.sid];
      if (d.moved && n && o) {
        if (o.auto) { o.auto = false; o.rx = this.orbitShape().rx; }   // tilting makes it a hand-placed orbit
        const side = n.x >= this.hub.x ? 1 : -1, dy = (e.clientY - d.ly) / this.cam.s;
        o.tilt = Math.max(-.2618, Math.min(.2618, (o.tilt || 0) + side * dy / Math.max(120, Math.min(o.rx, this.maxOrbit()))));
        this.c.style.cursor = 'ns-resize';
      }
      d.ly = e.clientY; return true;
    }
    if (d.moved && n) { const p = this.toWorld(e); n.x = p.x + d.dx; n.y = p.y + d.dy; n.dragging = true; this.c.style.cursor = 'grabbing'; }
    return true;
  },
  dragEnd() {
    const d = this.drag; if (!d) return; this.drag = null; this.c.style.cursor = ''; clearTimeout(this.holdTimer);
    if (d.held && !d.moved) return;                                // a hold without moving just opened the details
    const n = this.nodes.get(d.sid);
    if (!d.moved) return d.pick.startsWith('grp:') ? this.toggleGroup(d.pick.slice(4)) : this.onSelect(d.pick);
    if (d.tilt) return this.saveOrbits();
    if (n && this.bhDrop && this.bhDrop(n, d)) return;            // let go over the black hole: it eats it (/exit, blackhole.js)
    if (n) {
      n.dragging = false;
      const P = n.gslot && this.portals && this.portals.get(n.s.group);
      if (P) { const x = n.x, y = n.y; n.x -= P.off.x; n.y -= P.off.y; this.dropOrbit(n); n.x = x; n.y = y; }   // the portal's centre takes the orbit
      else this.dropOrbit(n);
    }
  },
  unpin(sid) { const o = this.loadOrbits(); if (o[sid]) { delete o[sid]; this.saveOrbits(); } },
});
