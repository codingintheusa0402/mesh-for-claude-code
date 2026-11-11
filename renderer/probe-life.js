// The probe's life (2026-10-27): grabbed and hauled about, lost to the black hole or the mother star, rebuilt on the
// Endurance.
//   Grab it (press and drag; a plain click still opens its menu): it's hauled along on a short tether and fights it the
//   whole way — nose turned away from you, engine blasting back at the pointer, wriggling, cursing. Let go and it bolts.
//   Drop it on the black hole (or let it stray too close) and it's torn apart like a bubble (blackhole.js). If it can't
//   break free of the mother star (probe.js probeGrav), it burns up in it. Either way the Endurance builds a new one:
//   10 s in its bay (three3d.js build), then the Chief, Probe Mk 0, launches again from the hub — same droid, a new paint job
//   (its colours turned round the hue wheel; kept across restarts).
// Loaded after probe.js / blackhole.js / endurance.js.

// the rebuild takes 10 s (Kevin 2026-10-30); the build bay's animation is scripted over 60 "bay seconds", played 6× fast
const PROBE_GEN_KEY = 'mesh.probeGen', PROBE_BUILD_T = 10, BAY_T = 60 / PROBE_BUILD_T;
const ROMAN = n => { const r = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let s = ''; for (const [v, c] of r) while (n >= v) { s += c; n -= v; } return s; };

Object.assign(Mesh.prototype, {
  // per frame, before its normal routine; true = it's handled this frame (dead / being built, held, falling in)
  probeLife(P, dt, base) {
    if (P.gen == null) { try { const g = JSON.parse(localStorage.getItem(PROBE_GEN_KEY)) || {}; P.gen = g.gen || 1; P.hue = g.hue || 0; } catch { P.gen = 1; P.hue = 0; } }
    if (this.orbitShape && (P.mode === 'dead' || P.fall || P.held)) { P.rot0 = this.sysRot || 0; P.k0 = this.orbitShape().k; }   // (so a system turn meanwhile isn't applied to it afterwards)
    if (P.mode === 'dead') return this.probeRebuildStep(P, dt, base);
    if (P.fall) return this.probeFallStep(P, base);
    if (P.held) return this.probeHeldStep(P, dt, base);
    // strays too close to the black hole: pulled in
    if (this.bhGeom && this.bhSwallowProbe && !this.compact && !this.off('mBlackHole') && P.mode !== 'sleep') {
      const B = this.bhGeom(); if (Math.hypot(P.x - B.x, P.y - B.y) < B.Rs * 1.9) { this.bhSwallowProbe(P, B); return this.probeFallStep(P, base); }
    }
    return false;
  },

  // ---- grabbed
  probeGrabStart(e) { this.probeGrab = { x0: e.clientX, y0: e.clientY, moved: false }; },
  probeGrabMove(e) {
    const g = this.probeGrab; if (!g) return;
    if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 5) {
      g.moved = true; const P = this.probeState(), t = this.time;
      P.held = { t0: t, sayAt: t + 3.2 };
      if (P.mode !== 'cruise' && P.mode !== 'roam') { P.mode = 'roam'; P.wp = null; P.sw = null; P.scan = null; P.target = null; P.queue = null; }   // whatever it was doing is off
      P.grav = null; P.napUntil = 0; P.idleSince = t;
      P.say = { text: probeLine('grab', ['Hey! Hands off!', 'Let go of me, motherfucker!', 'Whoa whoa, I did my time! Put me the fuck down!', 'This is kidnapping, you asshole!']), health: 'error', name: 'Probe', t0: t, hold: t + 3 };
      this.probeMenuClose && this.probeMenuClose(); this.c.style.cursor = 'grabbing';
    }
    if (g.moved) { const p = this.toWorld(e), H = this.probeState().held; if (H) { H.x = p.x; H.y = p.y; } }
  },
  // released: a click opens the menu; a drag lets it go (it bolts) — or drops it into the black hole
  probeGrabEnd() {
    const g = this.probeGrab; this.probeGrab = null; if (!g) return;
    if (!g.moved) return this.probeMenu && this.probeMenu(g.x0, g.y0);
    const P = this.probeState(), t = this.time, H = P.held; P.held = null; this.c.style.cursor = '';
    if (!H) return;
    if (this.bhGeom && !this.off('mBlackHole')) {
      const B = this.bhGeom(); if (Math.hypot(P.x - B.x, P.y - B.y) < B.cap) { this.bhSwallowProbe(P, B); return; }
    }
    const dx = P.x - H.x, dy = P.y - H.y, d = Math.hypot(dx, dy) || 1;            // bolt, away from you
    P.vx = dx / d * 430; P.vy = dy / d * 430; P.mode = 'roam'; P.wp = null; P.until = t + 5; P.target = null; P.idleSince = t;
    P.say = { text: probeLine('release', ['Freedom! Don\'t you ever do that again.', 'I\'m outta here!', 'Ha! No cell holds me, motherfucker.', 'Shit, my circuits are all twisted now. Thanks, asshole.']), health: 'working', name: 'Probe', t0: t, hold: t + 2.6 };
  },
  probeHeldStep(P, dt, base) {
    const H = P.held, t = this.time; if (H.x == null) { H.x = P.x; H.y = P.y; }
    const S = base * (1 + .35 * P.z), L = S * 1.7;                              // the tether
    // pulled toward the pointer, but thrusting away from it the whole time (in bursts), wriggling
    const dx = H.x - P.x, dy = H.y - P.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
    const flee = 340 * (.55 + .45 * Math.sin(t * 6.5)) * (Math.sin(t * 2.3) > -.6 ? 1 : .2), side = Math.sin(t * 4.1) * 180;
    P.vx += (dx * 16 - ux * flee - uy * side - P.vx * 4.5) * dt; P.vy += (dy * 16 - uy * flee + ux * side - P.vy * 4.5) * dt;
    P.x += P.vx * dt; P.y += P.vy * dt;
    const d2 = Math.hypot(H.x - P.x, H.y - P.y);
    if (d2 > L) { P.x = H.x - (H.x - P.x) / d2 * L; P.y = H.y - (H.y - P.y) / d2 * L; }   // can't get further than the tether
    P.z += (0 - P.z) * Math.min(1, dt * 3); P.gs = 1;
    // nose away from you, engine blasting back at the pointer, rocking
    const away = Math.atan2(-ux, -uy); let a = away - P.yaw; a = Math.atan2(Math.sin(a), Math.cos(a)); P.yaw += a * Math.min(1, dt * 6);
    P.bank = .45 * Math.sin(t * 11) + .2 * Math.sin(t * 17.3);
    P.flameDir = [ux, uy]; P.thrustOver = .9 + .3 * Math.sin(t * 23);
    if (t > H.sayAt) { H.sayAt = t + 3.4; P.say = { text: probeLine('held', ['Lemme go, goddamn it!', 'I got rights, you son of a bitch!', 'Put me down, warden!', 'Ow! Watch the fucking antenna!', 'Not the hole! Anything but the fucking hole!']), health: 'error', name: 'Probe', t0: t, hold: t + 3 }; }
    P.until += dt; P.nextLand += dt;
    P.S = S; P.dx = P.x + Math.sin(t * 29) * 1.2; P.dy = P.y + Math.cos(t * 31) * 1.2; P.sp = 200;
    return true;
  },

  // ---- falling into the black hole (blackhole.js moves it; here: where to draw it)
  probeFallStep(P, base) {
    const F = P.fall; if (!F) return false;
    P.S = base * Math.max(.05, Math.sqrt(F.mass)); P.dx = F.sx; P.dy = F.sy; P.x = F.sx; P.y = F.sy; P.sp = 0; P.z = F.far ? -.3 : .3;
    P.yaw += .25; P.bank = (P.bank || 0) + .08;                                 // tumbling as it's torn apart
    P.held = null; P.flameDir = null;
    return true;
  },

  // ---- lost: the Endurance builds the next one
  probeDie(cause) {
    const P = this.probeState(), t = this.time, gen = (P.gen || 1) + 1;
    P.mode = 'dead'; P.fall = null; P.held = null; P.grav = null; P.queue = null; P.target = null; P.scan = null;
    P.build = { t0: t, gen, hue: ((P.hue || 0) + 100 + Math.random() * 120) % 360, cause };
    P.say = { text: `${cause === 'star' ? 'Probe lost in the mother star.' : 'Probe lost to the black hole.'} Rebuilding Probe Mk 0. Back in ten seconds.`, health: 'error', name: 'Endurance', t0: t, hold: t + 5 };   // 5 s, then it fades (probeRebuildStep)
  },
  probeRebuildStep(P, dt, base) {
    const t = this.time, B = P.build, d = this.endDock ? this.endDock() : { x: this.w * .85, y: this.h * .2 };
    P.S = base * .5; P.x = P.dx = d.x; P.y = P.dy = d.y; P.sp = 0;
    if (P.say && !P.say.out && !(P.say.hold > t)) P.say.out = t;             // (probeStep's fade doesn't run while it's dead)
    if (P.say && P.say.out && t - P.say.out > .45) P.say = null;
    if (t - B.t0 >= PROBE_BUILD_T) {                                            // launch
      P.gen = B.gen; P.hue = B.hue; P.build = null;
      try { localStorage.setItem(PROBE_GEN_KEY, JSON.stringify({ gen: P.gen, hue: Math.round(P.hue) })); } catch { }
      P.mode = 'cruise'; P.vx = 0; P.vy = -180; P.z = 0; P.gs = .5; P.tg = 1; P.idleSince = t; P.nextLand = t + 12; P.gravCool = t + 120;
      this.probeNext(P);
      P.say = { text: probeLine('rebuild', ['Probe Mk 0 online. Same old con, new paint job. Where was I?', 'Mk 0 reporting. Fresh paint, same record.', 'Back from the dead. Mk 0. Don\'t push your fucking luck.'], { mk: '0' }), health: 'working', name: 'Probe', t0: t, hold: t + 4 };
    }
    return true;
  },
  // the bay on the Endurance (called from drawEndurance): the 3-D build at the hub, its progress under the station
  drawProbeBuild(ctx, G) {
    const P = this.probe; if (!P || P.mode !== 'dead' || !P.build) return;
    const t = (this.time - P.build.t0) * BAY_T, u = Math.min(1, t / 60), d = this.endDock ? this.endDock() : G;
    const M = window.Mesh3D && window.Mesh3D.build, sz = G.size * 1.05;
    if (M && M.ready) {
      // (the bay turns with the system: spin about its vertical, tilt = view elevation, plus how far the orbit plane is
      // opened up from its default view)
      const sh = this.orbitShape ? this.orbitShape() : null, elev = sh ? Math.asin(Math.max(-.95, Math.min(.95, sh.k))) - .42 : 0;
      const fresh = this.time - (this.bayAt || 0) > 1 / 31; if (fresh) this.bayAt = this.time;   // ≤30×/s
      const cv = !fresh && M.canvas ? M.canvas : M.render({ t, px: Math.min(this.lite ? 360 : 600, sz * this.dpr() * (this.cam ? Math.min(2, this.cam.s) : 1)), hue: P.build.hue, endSpin: this.endRot ? this.endRot() * 2 : 0, sysRot: this.sysRot || 0, sysTilt: this.sysTilt || 0, elev: elev * .6 });
      ctx.save(); ctx.globalAlpha = Math.min(1, t / 1.5); ctx.drawImage(cv, d.x - sz / 2, d.y - sz * .55, sz, sz); ctx.restore();
    } else {                                                                     // no 3-D: a plain progress ring at the hub
      ctx.save(); ctx.strokeStyle = 'rgba(140,220,255,.85)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(d.x, d.y, G.size * .14, -Math.PI / 2, -Math.PI / 2 + u * 6.283); ctx.stroke(); ctx.restore();
    }
    // the station's lasers: while the shell is sintered and during the scan, beams from three ring modules to the bay
    const lasing = t > 53 && t < 57;   // (the print itself is done by the bay's arms since 2026-10-29)
    if (lasing && this.endPoint) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
      for (const i of [1, 5, 9]) {
        const phi = Math.PI / 2 - i * Math.PI / 6, p = this.endPoint(Math.cos(phi) * 1.0, Math.sin(phi) * 1.0, .25), fl = .55 + .45 * Math.random();
        ctx.strokeStyle = `rgba(170,240,255,${(fl * .9).toFixed(2)})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(d.x, d.y); ctx.stroke();
        ctx.strokeStyle = `rgba(120,200,255,${(fl * .25).toFixed(2)})`; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(d.x, d.y); ctx.stroke();
      }
      const rr = sz * .06 * (1 + .3 * Math.random()); ctx.globalAlpha = .9; ctx.drawImage(glowSprite('#cff6ff'), d.x - rr, d.y - rr, rr * 2, rr * 2);
      ctx.restore();
    }
    const stage = t < 3 ? 'Powering up the bay' : t < 40 ? '3-D printing the probe, layer by layer' : t < 41 ? 'Inspecting' : t < 49 ? 'Spray painting' : t < 53 ? 'Powering on' : t < 57 ? 'Scanning · systems check' : 'Lift-off';
    const left = Math.max(0, Math.ceil(PROBE_BUILD_T - t / BAY_T)), y = G.y + G.size * .52 + 4, w = Math.max(120, G.size * .8);
    ctx.save(); ctx.font = '600 11px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(225,235,255,.9)'; ctx.fillText(`Rebuilding Probe Mk 0 · 0:${String(left).padStart(2, '0')}`, G.x, y);
    ctx.font = '500 10px -apple-system, system-ui, sans-serif'; ctx.fillStyle = 'rgba(190,205,235,.7)'; ctx.fillText(stage, G.x, y + 15);
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(G.x - w / 2, y + 30, w, 3);
    ctx.fillStyle = `hsl(${Math.round(P.build.hue)}, 80%, 65%)`; ctx.fillRect(G.x - w / 2, y + 30, w * u, 3);
    ctx.restore();
  },
});
