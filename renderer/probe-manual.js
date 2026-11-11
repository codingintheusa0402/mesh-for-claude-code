// Manual control (2026-10-30, Kevin): probe menu ▸ "Manual control" → fly that probe yourself.
//   W A S D   thrust that way (screen up / left / down / right; together = diagonals); the probe turns toward it
//   Shift     drift: the grip goes, it slides sideways through the turn like a racing game (held with W A S D)
//   Space     boost: a long flame and a lot more push, from a meter that refills
//   Esc       hand it back (or the probe menu ▸ Release control)
// It still lives in the mesh: it shoves bubbles it hits, bounces off the star, and the black hole will take it if you
// fly in. The camera follows it when it nears the edge of the view. Keys are only taken while the mesh has the focus
// (not while you're typing in a terminal or a field). A small HUD shows the keys, speed and the boost meter.
// Loaded after probe-crew.js.

Object.assign(Mesh.prototype, {
  manualStart(P) {
    P = P || this.probe; if (!P || P.mode === 'dead' || P.fall) return;
    for (const Q of this.probes || [P]) if (Q !== P && Q.manual) this.manualStop(Q);
    if (P.tidy && this.tidyStop) this.tidyStop(P); if (P.deliver && this.probeDeliverEnd) this.probeDeliverEnd(P, false);
    P.manual = { h: Math.atan2(P.vy || -1, P.vx || 0), boost: 1, keys: new Set(), puff: 0 }; P.mode = 'manual'; P.queue = null; P.target = null; P.scan = null; P.grav = null; P.napUntil = 0;
    P.say = { text: probeLine('manual', ['You drive, boss. Try not to kill me.', 'Manual mode. God help us all.', 'Hands on the stick. Don\'t crash my ass.']), health: 'working', name: 'Probe', t0: this.time, hold: this.time + 2.6 };
    this.manualHud(true); this.probeMenuClose && this.probeMenuClose();
  },
  manualStop(P) {
    P = P || (this.probes || [this.probe]).find(Q => Q && Q.manual); if (!P || !P.manual) return;
    P.manual = null; if (P.mode === 'manual') { P.mode = 'cruise'; this.probeNext(P); }
    P.say = { text: pick2(['Phew. I\'ll take it from here.', 'Back on autopilot. Thank fuck.', 'Not bad, warden. Not good either.']), health: 'idle', name: 'Probe', t0: this.time, hold: this.time + 2.2 };
    if (!(this.probes || []).some(Q => Q.manual)) this.manualHud(false);
  },
  manualStep(P, dt, base) {
    const M = P.manual, K = M.keys, t = this.time;
    let ix = (K.has('KeyD') ? 1 : 0) - (K.has('KeyA') ? 1 : 0), iy = (K.has('KeyS') ? 1 : 0) - (K.has('KeyW') ? 1 : 0); const il = Math.hypot(ix, iy); if (il) { ix /= il; iy /= il; }
    const drift = K.has('ShiftLeft') || K.has('ShiftRight'), boosting = K.has('Space') && M.boost > .02;
    M.boost = Math.max(0, Math.min(1, M.boost + (boosting ? -dt * .45 : dt * .18)));
    if (il) { const want = Math.atan2(iy, ix); let d = want - M.h; d = Math.atan2(Math.sin(d), Math.cos(d)); M.h += d * Math.min(1, dt * (drift ? 3.2 : 6.5)); }
    const hx = Math.cos(M.h), hy = Math.sin(M.h), acc = il ? (boosting ? 1500 : 720) : boosting ? 1100 : 0;
    P.vx += hx * acc * dt; P.vy += hy * acc * dt;
    // grip: the sideways part of the velocity dies fast (or barely, drifting); rolling drag on the rest
    const fwd = P.vx * hx + P.vy * hy, lat = -P.vx * hy + P.vy * hx, latK = Math.pow(drift ? .55 : .004, dt), fK = Math.pow(il || boosting ? .7 : .35, dt);
    const nf = fwd * fK, nl = lat * latK; P.vx = hx * nf - hy * nl; P.vy = hy * nf + hx * nl;
    const max = boosting ? 980 : 560, sp = Math.hypot(P.vx, P.vy); if (sp > max) { P.vx *= max / sp; P.vy *= max / sp; }
    P.x += P.vx * dt; P.y += P.vy * dt;
    // the edge of the map: a soft wall (it bounces back in)
    { const m = typeof MAP_M === 'number' ? MAP_M : .5, x0 = -m * this.w, x1 = (1 + m) * this.w, y0 = -m * this.h, y1 = (1 + m) * this.h;
      if (P.x < x0) { P.x = x0; P.vx = Math.abs(P.vx) * .5; } if (P.x > x1) { P.x = x1; P.vx = -Math.abs(P.vx) * .5; } if (P.y < y0) { P.y = y0; P.vy = Math.abs(P.vy) * .5; } if (P.y > y1) { P.y = y1; P.vy = -Math.abs(P.vy) * .5; } }
    // the yard pushes back: bubbles get shoved, the star bounces it, the hole takes it
    for (const n of this.nodes.values()) { if (n.dying || n.eaten || n.gslot) continue; const R = this.nodeRadius(n) * (n.gscale ?? 1) + base * .5, dx = n.x - P.x, dy = n.y - P.y, d = Math.hypot(dx, dy); if (d < R && d > 0) { const k = (R - d) / R; n.vx += dx / d * sp * k * 1.2; n.vy += dy / d * sp * k * 1.2; P.vx -= dx / d * sp * k * .5; P.vy -= dy / d * sp * k * .5; if (sp > 300 && Math.random() < .3) P.say = { text: pick2(['Excuse me!', 'Bunk check!', 'Outta my way!', 'Oops.']), health: 'working', name: 'Probe', t0: t, hold: t + 1.2 }; } }
    { const H = this.hub, R = this.motherRadius() + base * .6, dx = P.x - H.x, dy = P.y - H.y, d = Math.hypot(dx, dy) || 1; if (d < R) { P.x = H.x + dx / d * R; P.y = H.y + dy / d * R; const vn = (P.vx * dx + P.vy * dy) / d; if (vn < 0) { P.vx -= 1.8 * vn * dx / d; P.vy -= 1.8 * vn * dy / d; } P.say = { text: 'HOT! Hot hot hot!', health: 'error', name: 'Probe', t0: t, hold: t + 1.2 }; } }
    if (this.bhGeom && !this.off('mBlackHole')) { const B = this.bhGeom(); if (Math.hypot(P.x - B.x, P.y - B.y) < B.Rs * 1.9) { P.manual = null; this.manualHud(false); this.bhSwallowProbe(P, B); return true; } }
    // pose: nose along the heading, banked by the slide; flame out the back (long when boosting); drift smoke
    const want = Math.atan2(hx, hy); { let d = want - P.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); P.yaw += d * Math.min(1, dt * 10); }
    P.bank = (P.bank || 0) + (Math.max(-.7, Math.min(.7, -lat / 400)) - (P.bank || 0)) * Math.min(1, dt * 8);
    P.thrustOver = acc ? (boosting ? 1.6 : 1) : .1; P.flameDir = [-hx, -hy];
    if (drift && Math.abs(lat) > 120) { M.puff += dt * 30; while (M.puff >= 1) { M.puff--; P.flame.push({ x: P.x - hx * base * .5 + (Math.random() - .5) * 10, y: P.y - hy * base * .5 + (Math.random() - .5) * 10, vx: (Math.random() - .5) * 40, vy: (Math.random() - .5) * 40, life: 1, d: .7 }); } }
    if (drift && Math.abs(lat) > 260 && !(P.say && P.say.hold > t)) P.say = { text: pick2(['Drift king, motherfucker!', 'Wheeee!', 'Look at that slide!', 'Tokyo drift, baby!']), health: 'working', name: 'Probe', t0: t, hold: t + 1.5 };
    if (P.say && !P.say.out && !(P.say.hold > t)) P.say.out = t;
    if (P.say && P.say.out && t - P.say.out > .45) P.say = null;
    P.z += (0 - P.z) * Math.min(1, dt * 3); P.gs = 1; P.idleSince = t; P.nextLand = t + 60; P.workAt = t;
    P.S = base * (1 + .35 * P.z); P.dx = P.x; P.dy = P.y; P.sp = Math.hypot(P.vx, P.vy); P.hd = M.h;
    // keep it on screen: the camera follows when it nears the edge
    const c = this.cam, sx = c.tx + P.x * c.s, sy = c.ty + P.y * c.s, mx = this.w * .2, my = this.h * .2;
    if (sx < mx || sx > this.w - mx || sy < my || sy > this.h - my) { c.ttx = this.w / 2 - P.x * c.s; c.tty = this.h / 2 - P.y * c.s; }
    this.manualHudUpdate(P);
    return true;
  },
  manualHud(on) {
    let el = this.manualEl;
    if (on && !el) {
      el = this.manualEl = document.createElement('div'); el.id = 'manualHud';
      el.innerHTML = '<b></b><span class="k"><i>W A S D</i> move</span><span class="k"><i>⇧</i> drift</span><span class="k"><i>Space</i> boost</span><span class="k"><i>Esc</i> release</span><span class="sp"></span><span class="bm"><i></i></span>';
      const st = document.createElement('style'); st.textContent = `#manualHud { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 35; display: flex; align-items: center; gap: 12px; padding: 8px 14px; border-radius: 12px; background: rgba(12,14,22,.72); border: 1px solid rgba(255,255,255,.14); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); color: #e8ebf4; font: 500 12px -apple-system, system-ui, sans-serif; white-space: nowrap; pointer-events: none; }
        #manualHud b { color: #ffd65a; font-weight: 600; } #manualHud .k i { font-style: normal; padding: 1px 6px; margin-right: 4px; border: 1px solid rgba(255,255,255,.25); border-radius: 4px; font-size: 11px; }
        #manualHud .sp { font-variant-numeric: tabular-nums; min-width: 58px; text-align: right; color: #9fd8ff; } #manualHud .bm { width: 70px; height: 6px; border-radius: 3px; background: rgba(255,255,255,.12); overflow: hidden; } #manualHud .bm i { display: block; height: 100%; background: linear-gradient(90deg, #ff9a3c, #ffd65a); }`;
      document.head.appendChild(st); document.body.appendChild(el);
    }
    if (el) el.style.display = on ? 'flex' : 'none';
  },
  manualHudUpdate(P) {
    const el = this.manualEl; if (!el) return; if ((this.manualT || 0) > this.time - .1) return; this.manualT = this.time;
    el.querySelector('b').textContent = 'Manual · ' + (this.probeName ? this.probeName(P) : 'Probe'); el.querySelector('.sp').textContent = Math.round(P.sp || 0) + ' px/s'; el.querySelector('.bm i').style.width = Math.round(P.manual.boost * 100) + '%';
  },
});

{
  const M = Mesh.prototype;
  // the flying: before everything else in the probe's frame
  const life0 = M.probeLife;
  M.probeLife = function (P, dt, base) { if (P.manual && !P.held && !P.fall && P.mode !== 'dead' && !this.story) return this.manualStep(P, dt, base); return life0.call(this, P, dt, base); };
  // the screen saver doesn't start while you're flying
  const ok0 = M.cineAllowed;
  M.cineAllowed = function () { return !(this.probes || [this.probe]).some(P => P && P.manual) && ok0.call(this); };
  // the keys (only while the mesh has the focus — never steals typing from a terminal or a field)
  const KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'Space', 'Escape']);
  const typing = () => { const a = document.activeElement; return a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || (a.closest && a.closest('.xterm, #modal:not(.hidden), #hangar'))); };
  const flyer = () => typeof viz !== 'undefined' && (viz.probes || [viz.probe]).find(P => P && P.manual);
  addEventListener('keydown', e => { const P = flyer(); if (!P || !KEYS.has(e.code) || typing() || e.metaKey || e.ctrlKey) return; e.preventDefault(); e.stopPropagation(); if (e.code === 'Escape') return viz.manualStop(P); P.manual.keys.add(e.code); }, true);
  addEventListener('keyup', e => { const P = flyer(); if (!P || !KEYS.has(e.code)) return; P.manual.keys.delete(e.code); }, true);
  addEventListener('blur', () => { const P = flyer(); if (P) P.manual.keys.clear(); });
}
