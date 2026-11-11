// The Endurance (2026-10-27): the ring station from Interstellar, parked top-right of the map — the probe's home.
// When nothing has been working for 5 minutes the probe flies here and sleeps docked on the core hub (it used to nap
// on the mother star). Modelled in Blender (assets/endurance/build_endurance.py: 12 modules — habitats, landing pods,
// engine modules with their three nozzle discs — joined by tunnels through ring airlocks, a spoke across the ring, the
// docking hub with two Landers and two Rangers; white paint with panel seams, dents, grime and worn edges).
// 2026-10-27 (later): real 3-D. bake_endurance.py bakes all that surface detail into textures on one mesh
// (endurance.glb) and three3d.js renders it live: it spins about its axis while the axis swings slowly through face-on,
// oblique, near edge-on and back views, lit by a fixed sun with real self-shadowing. Drag it to turn it yourself.
// Without WebGL it falls back to the pre-rendered spin sheet (endurance_sheet.webp, 48 frames for half a turn).
// The red / green nav lights and the hub strobe blink on top. Loaded after probe.js; three3d.js arrives on its own.
// Also here: dragging the two 3-D objects — a plain drag moves them (handles.js), ⌘-drag turns the Endurance / tilts
// the black hole round every side (blackhole.js bhRotate).

const END_META = { frames: 48, cols: 8, cell: 320, turn: 180, ortho: 2.433, ringR: 1, elev: 32, hubFront: .3 };
let endImg = null;                                                 // the 2-D fallback sheet, loaded only if 3-D never shows up
const END_SPIN = Math.PI / 34;                                     // rad/s about its own axis
const end3 = () => window.Mesh3D && window.Mesh3D.end && window.Mesh3D.end.ready ? window.Mesh3D.end : null;

Object.assign(Mesh.prototype, {
  // where it is (world coords): top-right, out of the orbit ring's way; size = the drawn square
  endGeom() {
    const s = Math.max(.62, Math.min(1.1, Math.min(this.w, this.h) / 820)) * (this.lite ? .85 : 1), size0 = 175 * s, size = size0 * (this.sizeOf ? this.sizeOf('end') : 1);
    const bob = Math.sin(this.time * .35) * 3;                    // a slow drift, it's floating
    // a body in the orbit plane (handles.js planeSpot): out past the ring, top-right at rest (far side), carried round
    // by the system's spin; nearer = bigger
    const at = this.planeSpot ? this.planeSpot('end', -.62, 1.3) : { x: this.w - Math.max(size0 * .6, this.w * .11), y: Math.max(size0 * .6, this.h * .2), z: 0 };
    return { x: at.x, y: at.y + bob, size: size * (1 + .22 * at.z), s, z: at.z };
  },
  endRot() { return this.time * END_SPIN; },
  // how its axis is turned: a slow swing through every side of it, plus whatever you dragged in
  endView() {
    const t = this.time, U = this.endUser || (this.endUser = { yaw: 0, pitch: 0 });
    // + the orbit plane's tilt (dragging the spin band up/down tilts the whole system, the station with it)
    // the system's spin / tilt are applied outside this (three3d.js): a spin turns it about the orbit plane's normal, a tilt pitches it with the plane
    return { yaw: 1.25 * Math.sin(t * .037) + U.yaw, pitch: .3 + .42 * Math.sin(t * .053 + 1.3) + U.pitch };
  },
  // a point on the station (Blender coords: x/y in the ring plane, z along the axis) → world
  endPoint(px, py, pz) {
    const G = this.endGeom(), E = end3();
    if (E) { const q = E.project(px, pz, -py); return { x: G.x + q.x * G.size / 2, y: G.y - q.y * G.size / 2, near: q.near }; }   // glTF is +Y up
    const M = END_META, a = -this.endRot(), e = M.elev * Math.PI / 180, u = G.size / M.ortho;
    const x = px * Math.cos(a) - py * Math.sin(a), y = px * Math.sin(a) + py * Math.cos(a);
    return { x: G.x + x * u, y: G.y - (y * Math.cos(e) + pz * Math.sin(e)) * u, near: true };
  },
  // where the probe sits asleep: the docking collar on whichever end of the hub faces you
  endDock() {
    const f = this.endPoint(0, 0, END_META.hubFront + .04);
    return f.near ? f : this.endPoint(0, 0, -.26);
  },
  // pass 'far' is drawn before the star, 'near' after it — whichever side of the orbit it's on now
  drawEndurance(ctx, pass = 'near') {
    if (this.compact || this.off('mEndurance')) return;
    const G0 = this.endGeom(); if ((G0.z < 0) !== (pass === 'far')) return;
    const G = G0, t = this.time, sz = G.size, x0 = G.x - sz / 2, y0 = G.y - sz / 2, E = end3();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .07; ctx.drawImage(glowSprite('#cfe0ff'), G.x - sz * .6, G.y - sz * .55, sz * 1.2, sz * 1.1);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    if (E) {
      const V = this.endView(), px = Math.min(this.lite ? 420 : 640, sz * this.dpr() * (this.cam ? Math.min(2, this.cam.s) : 1));
      // iPhone: a fresh frame every other draw is plenty for something this slow
      const vw = this.view(), onScreen = G.x + sz * .6 > vw.x0 && G.x - sz * .6 < vw.x1 && G.y + sz * .6 > vw.y0 && G.y - sz * .6 < vw.y1;
      const stale = this.time - (this.endAt || 0) > (this.cine || this.spinDrag || this.sysVel ? 0 : 1 / 31);   // every frame while turning / the screen saver, else 30×/s (in front or not)
      if (stale && onScreen) this.endAt = this.time;
      const cv = (this.lite && (this.endSkip = !this.endSkip) && this.endDrawn) || ((!onScreen || !stale) && this.endDrawn) ? E.canvas : E.render({ px, spin: this.endRot() * 2, yaw: V.yaw, pitch: V.pitch, sysRot: -(this.sysRot || 0), sysTilt: this.sysTilt || 0, k: this.orbitShape().k });   // (not re-rendered off the view)
      this.endDrawn = true; ctx.drawImage(cv, x0, y0, sz, sz);
    } else {
      if (!endImg && t > 6) { endImg = new Image(); endImg.src = (location.protocol === 'file:' ? '' : '/') + 'endurance/endurance_sheet.webp'; }
      if (!endImg || !endImg.complete || !endImg.naturalWidth) { ctx.restore(); return; }
      const M = END_META, F = M.frames, C = M.cell;
      const ph = (this.endRot() % Math.PI) / Math.PI * F, f0 = Math.floor(ph) % F, f1 = (f0 + 1) % F, fr = ph - Math.floor(ph);
      const cols = Math.round(endImg.naturalWidth / C) || M.cols;
      const blit = (f, a) => { ctx.globalAlpha = a; ctx.drawImage(endImg, (f % cols) * C, Math.floor(f / cols) * C, C, C, x0, y0, sz, sz); };
      blit(f0, 1); if (fr > .02) blit(f1, fr);                    // crossfade to the next frame: a smooth slow spin
    }
    // nav lights: green on one side of the ring, red opposite, blinking out of step (only when on the near side);
    // a white strobe on the hub
    ctx.globalCompositeOperation = 'lighter';
    for (const [i, col, off] of [[3, '#41ff7a', 0], [9, '#ff3b30', .5]]) {
      if (((t * .9 + off) % 1) >= .18) continue;
      const phi = Math.PI / 2 - i * Math.PI / 6, p = this.endPoint(Math.cos(phi) * 1.16, Math.sin(phi) * 1.16, .2);
      if (!p.near) continue;
      const r = sz * .035; ctx.globalAlpha = .9; ctx.drawImage(glowSprite(col), p.x - r, p.y - r, r * 2, r * 2);
      ctx.fillStyle = '#fff'; ctx.fillRect(p.x - .8, p.y - .8, 1.6, 1.6);
    }
    if (this.drawProbeBuild) { ctx.restore(); ctx.save(); this.drawProbeBuild(ctx, G); ctx.globalCompositeOperation = 'lighter'; }   // a new probe being built at the hub (probe-life.js)
    if ((t % 2.4) < .08) { const p = this.endDock(), r = sz * .05; ctx.globalAlpha = .7; ctx.drawImage(glowSprite('#ffffff'), p.x - r, p.y - r, r * 2, r * 2); }
    ctx.restore();
    // its name on hover
    if (this.cursor.in && Math.hypot(this.cursor.x - G.x, this.cursor.y - G.y) < sz * .45) {
      ctx.save(); ctx.font = '600 11px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(225,232,245,.85)'; ctx.fillText('Endurance', G.x, G.y + sz * .5 + 2);
      ctx.font = '500 10px -apple-system, system-ui, sans-serif'; ctx.fillStyle = 'rgba(200,210,230,.6)';
      ctx.fillText(this.probe && this.probe.mode === 'sleep' ? 'the probe is asleep here · ⌘-drag to turn' : 'the probe\'s home · ⌘-drag to turn', G.x, G.y + sz * .5 + 16);
      ctx.restore();
    }
  },

  // ---- dragging the 3-D objects: the Endurance turns (sideways = round its vertical, up/down = tip), the black hole
  // tilts (up/down: from edge-on to well above or below its disk)
  objHit(p) {
    if (this.compact) return null;
    if (!this.off('mEndurance')) { const G = this.endGeom(); if (Math.hypot(p.x - G.x, p.y - G.y) < G.size * .42) return 'end'; }
    if (this.bhGeom && !this.off('mBlackHole')) { const B = this.bhGeom(); if (Math.hypot(p.x - B.x, p.y - B.y) < Math.max(B.Rs * 2.4, B.Ro * .7)) return 'bh'; }
    return null;
  },
  objDragStart(e, kind) {
    kind = kind || this.objHit(this.toWorld(e)); if (!kind) return false;
    if (!e.metaKey && this.objMoveStart) { this.objMoveStart(kind, e); return true; }   // plain drag moves it (handles.js); ⌘-drag turns / tilts it
    this.objDrag = { kind, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY }; this.c.style.cursor = 'grabbing'; return true;
  },
  objDragMove(e) {
    const d = this.objDrag; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y; d.x = e.clientX; d.y = e.clientY; this.lastInput = performance.now();
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.far = true; else if (!d.far) return;   // (a click doesn't nudge it)
    if (d.move) return this.objMoveTo(e);
    if (d.kind === 'end') { const U = this.endUser || (this.endUser = { yaw: 0, pitch: 0 }); U.yaw += dx * .012; U.pitch += dy * .012; }
    else this.bhRotate(dx, dy);                                    // the black hole turns all the way round too
  },
  // a click (no drag) on the Endurance opens its hangar: the skills and connectors (hangar.js); on the black hole, the cleanup (cleanup.js)
  objDragEnd() { const d = this.objDrag; this.objDrag = null; this.c.style.cursor = ''; if (d && !d.far && d.kind === 'end' && this.onEndClick) this.onEndClick(d.sx, d.sy); if (d && !d.far && d.kind === 'bh' && this.onHoleClick) this.onHoleClick(); },
});
fetch((location.protocol === 'file:' ? '' : '/') + 'endurance/endurance.json').then(r => r.json()).then(m => Object.assign(END_META, m)).catch(() => { });
