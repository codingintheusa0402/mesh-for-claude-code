// The probe tidies up the mesh (2026-10-29): probe menu ▸ "Tidy up the bubbles". It works out a layout that's easy to
// work with and tows every bubble there, one by one.
//   The layout: evenly spaced slots on ONE shared orbit (same radius → same speed, so the spacing holds as they turn),
//   ordered by what needs you — waiting / erroring sessions front and centre on the near side, then working ones, then
//   silent, then idle (most recent first) — and the groups on an outer ring; if the ring can't hold everyone without
//   crowding, the overflow goes to the outer ring too. Hand-placed orbits and tilts are reset; the old ones are kept for
//   "Undo tidy-up".
//   The motion, per bubble: the probe flies over and hovers above it → a tractor tether locks on (a clamp ring closes,
//   the bubble lifts a little) → it tows the bubble along a swooping arc to its slot, the bubble swinging behind on the
//   tether like a sling load → it eases it into the slot, a click-in flash, the tether lets go → the next one.
//   Grabbing the probe, or dragging the bubble it's towing, stops the tidy-up there (everything already placed stays).
// Loaded after probe-life.js.

const TIDY_RANK = { waiting: 0, error: 1, working: 2, quiet: 3 };

Object.assign(Mesh.prototype, {
  // ---------------- the plan ----------------
  tidyPlan() {
    const sh = this.orbitShape();
    const items = [...this.nodes.values()].filter(n => !n.dying && !n.eaten && !n.gslot && n.s)
      .map(n => ({ kind: 'node', sid: n.sid, h: n.s.health, age: n.s.sinceWrite, need: Math.max(this.nodeRadius(n) * 2.6, (n.labelW || 150) + 18) }));
    if (this.portals) for (const [gid, P] of this.portals) if (P.node && P.members && P.members.length) {   // a group ranks as its neediest member
      const m = P.members.map(n => n.s || {}).sort((x, y) => (TIDY_RANK[x.health] ?? 4) - (TIDY_RANK[y.health] ?? 4))[0];
      items.push({ kind: 'group', gid, h: m.health, age: Math.min(...P.members.map(n => (n.s && n.s.sinceWrite) ?? 1e8)), need: Math.max(180, (P.R || 60) * 2.2) });
    }
    const rank = it => (TIDY_RANK[it.h] ?? 4) * 1e9 + (it.age ?? 1e8);
    items.sort((a, b) => rank(a) - rank(b));
    // how many fit on the main ring: each needs room for its bubble and its name tag side by side
    const kk = Math.abs(sh.k), perim = Math.PI * sh.rx * (3 * (1 + kk) - Math.sqrt((3 + kk) * (1 + 3 * kk)));   // Ramanujan
    let cap = items.length, used = 0;
    for (let i = 0; i < items.length; i++) { used += items[i].need; if (used > perim * .95) { cap = Math.max(3, i); break; } }
    const rx2 = Math.min(this.maxOrbit(), sh.rx * 1.38), roomy = rx2 > sh.rx * 1.12;   // overflow ring (if the map has room)
    const inner = roomy ? items.slice(0, cap) : items, outer = roomy ? items.slice(cap) : [];
    // slot order: the front (angle π/2 = the near side, in front of the star) first, then alternating either side of it;
    // the overflow ring starts at the back so it doesn't sit in front of the main ring's front row
    const order = N => { const o = [0]; for (let i = 1; o.length < N; i++) { o.push(i); if (o.length < N) o.push(N - i); } return o; };
    const jobs = [], T0 = Date.now();
    const ring = (list, rx, front) => {
      const N = list.length; if (!N) return; const ord = order(N), w = this.omegaAt(rx), base0 = front - (this.sysRot || 0);
      list.forEach((it, i) => jobs.push({ kind: it.kind, sid: it.sid, gid: it.gid, rx, slot: ord[i], N, w, base0, T0 }));
    };
    ring(inner, sh.rx, Math.PI / 2);
    ring(outer, rx2, -Math.PI / 2 + Math.PI / Math.max(2, outer.length));
    return jobs;
  },
  // where a slot is right now (it turns with its ring); angle is the orbit angle without the system's spin
  tidySlot(J) {
    const sh = this.orbitShape(), ang = J.base0 + J.w * (Date.now() - J.T0) / 1000 + J.slot * 2 * Math.PI / J.N, a = ang + (this.sysRot || 0);
    return { x: this.hub.x + Math.cos(a) * J.rx, y: this.hub.y + Math.sin(a) * J.rx * sh.k, ang };
  },
  // the thing being moved: a bubble, or a group's portal (moved through its anchor member)
  tidyItem(J) {
    if (J.kind === 'node') { const n = this.nodes.get(J.sid); return n && !n.dying && !n.eaten && !n.gslot ? { n, x: n.x, y: n.y, R: this.nodeRadius(n) * (n.gscale ?? 1) } : null; }
    const P = this.portals && this.portals.get(J.gid); if (!P || !P.node || !P.members || !P.members.length) return null;
    return { P, a: P.members[0], x: P.x, y: P.y, R: Math.max(30, (P.R || 80) * .35) };
  },
  tidyMove(it, x, y) {
    if (it.n) { it.n.x = x; it.n.y = y; it.n.vx = it.n.vy = 0; it.n.dragging = true; }
    else { const off = it.P.off || { x: 0, y: 0 }; it.a.dragging = true; it.a.x = x + off.x; it.a.y = y + off.y; it.a.vx = it.a.vy = 0; }
  },
  tidyRelease(it, J, placed) {
    const o = this.loadOrbits(), key = it.n ? it.n.sid : it.a.sid;
    if (placed) { const s = this.tidySlot(J); o[key] = { rx: J.rx, a0: s.ang, t0: Date.now(), tilt: 0, ...(J.kind === 'group' ? { far: 2 } : {}) }; this.saveOrbits(); }
    if (it.n) { it.n.dragging = false; if (!placed) this.dropOrbit(it.n); }
    else { it.a.dragging = false; }
  },

  // ---------------- start / stop ----------------
  probeTidy() {
    const P = this.probeState(), jobs = this.tidyPlan(), t = this.time;
    if (!jobs.length) return;
    try { this.tidyUndo = JSON.parse(JSON.stringify(this.loadOrbits())); } catch { this.tidyUndo = null; }
    // one shared queue: every probe on the crew takes the next bubble from it (2026-10-29); 6+ bubbles → the Endurance
    // launches crew probes to help (probe-crew.js), up to 3 in all
    const q = { jobs, next: 0, done: 0, flashes: [] };
    if (this.crewLaunch && jobs.length >= 6) this.crewLaunch(Math.min(2, Math.ceil(jobs.length / 5) - 1));
    const crew = this.probes && this.probes.length ? this.probes.filter(W => W.mode !== 'dead' && !W.held && !W.fall && !W.deliver && !W.recall) : [P];
    if (!crew.includes(P)) crew.unshift(P);
    for (const W of crew) {
      W.tidy = { q, i: -1, phase: 'next', t0: t };
      W.mode = 'tidy'; W.queue = null; W.target = null; W.scan = null; W.grav = null; W.napUntil = 0;
    }
    P.say = { text: probeLine('tidyStart', ['Alright, line up! Cell inspection. Bunks in order — the ones who need the boss up front.', 'Yard\'s a goddamn mess. Watch me sort this shit out.', 'Everybody in formation, assholes. I\'ve seen tidier riots.']), health: 'working', name: 'Probe', t0: t, hold: t + 4 };
  },
  probeTidyUndo() {
    if (!this.tidyUndo) return;
    this.orbits = this.tidyUndo; this.saveOrbits(); this.tidyUndo = null;
    const P = this.probeState(), t = this.time;
    P.say = { text: 'Fine, back to the mess you had. Your call, warden.', health: 'idle', name: 'Probe', t0: t, hold: t + 3 };
  },
  tidyStop(P, why) {
    const T = P.tidy; if (!T) return;
    const J = T.q.jobs[T.i], it = J && T.it;
    if (it && (T.phase === 'grab' || T.phase === 'tow' || T.phase === 'set')) this.tidyRelease(it, J, false);
    P.tidy = null; if (P.mode === 'tidy') { P.mode = 'cruise'; this.probeNext(P); }
    if (why) P.say = { text: why, health: 'idle', name: 'Probe', t0: this.time, hold: this.time + 3 };
  },
  // before anything else in the probe's frame: grabbed / lost / sent elsewhere → the tidy-up stops cleanly
  probeTidyCheck(P) {
    if (!P.tidy) return;
    if (P.held || P.fall || P.mode === 'dead') return this.tidyStop(P, P.held ? 'Hey! I was working here!' : null);
    if (P.mode !== 'tidy') return this.tidyStop(P);
    const J = P.tidy.q.jobs[P.tidy.i];
    if (J && this.drag && P.tidy.it && P.tidy.it.n && this.drag.sid === P.tidy.it.n.sid) this.tidyStop(P, 'All yours. I\'ll stop sorting.');
  },

  // ---------------- the motion ----------------
  probeTidyStep(P, dt, base) {
    const T = P.tidy; if (!T || P.mode !== 'tidy') return false;
    const t = this.time, S = base, perch = S * 1.25 + 8;
    P.idleSince = t; P.until = t + 5; P.nextLand = Math.max(P.nextLand || 0, t + 30);
    let J = T.q.jobs[T.i], it = J && this.tidyItem(J);
    const next = () => {
      T.i = T.redo != null ? T.redo : T.q.next++; T.redo = null; T.phase = 'go'; T.t0 = t; T.it = null;
      // skip sessions that ended meanwhile, and ones already sitting in their slot (a second tidy-up only moves strays)
      const placed = J => { const it = this.tidyItem(J); if (!it) return true; const sl = this.tidySlot(J); if (Math.hypot(it.x - sl.x, it.y - sl.y) > 22) return false; this.tidyRelease(it, J, true); T.q.done++; return true; };
      while (T.i < T.q.jobs.length && placed(T.q.jobs[T.i])) T.i = T.q.next++;
      if (T.i >= T.q.jobs.length) {
        P.tidy = null; P.mode = 'cruise'; this.probeNext(P);
        if (this.probes && this.probes.some(W => W !== P && W.tidy && W.tidy.q === T.q)) return false;   // the crew's still at it: only the last one reports
        P.say = { text: probeLine('tidyDone', [`Done. ${T.q.done} in formation, the ones that need you up front. Clean as a fresh cell.`, `${T.q.done} bunks made. Front row's yours, warden.`, 'Yard\'s tidy. Don\'t fuck it up.'], { n: T.q.done }), health: 'working', name: 'Probe', t0: t, hold: t + 4 };
        return false;
      }
      return true;
    };
    if (T.phase === 'next') { if (!next()) return false; J = T.q.jobs[T.i]; it = this.tidyItem(J); }
    if (!it) { if (T.it) this.tidyRelease(T.it, J, false); T.phase = 'next'; return true; }
    const steer = (tx, ty, k, max) => {
      const ax = (tx - P.x) * k - P.vx * 2 * Math.sqrt(k) * .9, ay = (ty - P.y) * k - P.vy * 2 * Math.sqrt(k) * .9;
      P.vx += ax * dt; P.vy += ay * dt; const sp = Math.hypot(P.vx, P.vy); if (sp > max) { P.vx *= max / sp; P.vy *= max / sp; }
      P.x += P.vx * dt; P.y += P.vy * dt;
    };
    const age = t - T.t0, ease = u => u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    if (T.phase === 'go') {                                                     // fly over and hover above it
      const hx = it.x, hy = it.y - it.R - perch; steer(hx, hy, 9, 520);
      if ((Math.hypot(P.x - hx, P.y - hy) < 10 && Math.hypot(P.vx, P.vy) < 60) || age > 2) { T.phase = 'grab'; T.t0 = t; T.it = it; T.from = { x: it.x, y: it.y }; T.bx = it.x; T.by = it.y; T.bvx = 0; T.bvy = 0; }
    } else if (T.phase === 'grab') {                                            // tether locks on, the bubble lifts a touch
      const u = Math.min(1, age / .45); T.lock = u;
      steer(T.from.x, T.from.y - it.R - perch - 6 * u, 14, 300);
      T.by = T.from.y - 10 * Math.sin(u * Math.PI / 2); T.bx = T.from.x; this.tidyMove(T.it, T.bx, T.by);
      if (u >= 1) {
        const s = this.tidySlot(J), d = Math.hypot(s.x - T.bx, s.y - T.by);
        T.phase = d < 14 ? 'set' : 'tow'; T.t0 = t; T.dur = Math.max(.8, Math.min(2, d / 380)); T.start = { x: P.x, y: P.y };
        const nx = -(s.y - T.by) / (d || 1), ny = (s.x - T.bx) / (d || 1), side = ((s.x - this.hub.x) * ny - (s.y - this.hub.y) * nx) > 0 ? -1 : 1;
        T.bend = { x: nx * side * Math.min(160, d * .35), y: ny * side * Math.min(160, d * .35) - Math.min(90, d * .25) };   // a swooping arc, a little up
      }
    } else if (T.phase === 'tow') {                                             // swoop to the slot, the load swinging behind
      const s = this.tidySlot(J), u = Math.min(1, age / T.dur), e = ease(u), a = 1 - e;
      const ex = s.x, ey = s.y - it.R - perch, c1x = T.start.x + T.bend.x, c1y = T.start.y + T.bend.y, c2x = ex + T.bend.x * .4, c2y = ey + T.bend.y * .4;
      const nx = a * a * a * T.start.x + 3 * a * a * e * c1x + 3 * a * e * e * c2x + e * e * e * ex, ny = a * a * a * T.start.y + 3 * a * a * e * c1y + 3 * a * e * e * c2y + e * e * e * ey;
      P.vx = (nx - P.x) / Math.max(dt, 1e-3); P.vy = (ny - P.y) / Math.max(dt, 1e-3); P.x = nx; P.y = ny;
      // the load: a damped spring hanging from the probe (a little sway, never a wild swing)
      const hx = P.x, hy = P.y + it.R + perch, k = 60, c = 2 * Math.sqrt(k) * .55;
      T.bvx += ((hx - T.bx) * k - T.bvx * c) * dt; T.bvy += ((hy - T.by) * k - T.bvy * c) * dt; T.bx += T.bvx * dt; T.by += T.bvy * dt;
      this.tidyMove(T.it, T.bx, T.by);
      if (u >= 1) { T.phase = 'set'; T.t0 = t; T.sx = T.bx; T.sy = T.by; }
    } else if (T.phase === 'set') {                                             // ease exactly into the slot
      const s = this.tidySlot(J), u = Math.min(1, age / .45), e = ease(u);
      T.bx = (T.sx ?? T.bx) + (s.x - (T.sx ?? T.bx)) * e; T.by = (T.sy ?? T.by) + (s.y - (T.sy ?? T.by)) * e; this.tidyMove(T.it, T.bx, T.by);
      steer(s.x, s.y - it.R - perch, 14, 300); T.lock = 1 - Math.max(0, (u - .7) / .3);
      if (u >= 1) {
        this.tidyRelease(T.it, J, true); T.q.done++;
        T.q.flashes.push({ x: s.x, y: s.y, R: it.R, t0: t });
        if (T.q.done === 1 || Math.random() < .3) P.say = { text: probeLine('tidyEach', ['In you go.', 'Bunk assigned.', 'Next, motherfucker!', 'Stay put this time, asshole.', 'Front row, you\'re waiting on the boss.', 'Lights out for this one.']), health: 'working', name: 'Probe', t0: t, hold: t + 1.6 };
        T.phase = 'next';
      }
    }
    // the droid's pose: face the way it moves, bank into turns, hover bob
    const sp = Math.hypot(P.vx, P.vy), want = sp > 25 ? Math.atan2(P.vx, P.vy) : 0;
    { let d = want - P.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); P.yaw += d * Math.min(1, dt * (sp > 25 ? 5 : 2)); }
    const hd = Math.atan2(P.vy, P.vx); let w = 0; if (sp > 25 && P.hd != null) { w = hd - P.hd; w = Math.atan2(Math.sin(w), Math.cos(w)) / Math.max(dt, 1e-3); }
    P.hd = sp > 25 ? hd : P.hd; P.bank = (P.bank || 0) + (Math.max(-.6, Math.min(.6, w * .22)) - (P.bank || 0)) * Math.min(1, dt * 5);
    P.z += (0 - P.z) * Math.min(1, dt * 3); P.gs = 1;
    if (P.say && !P.say.out && !(P.say.hold > t)) P.say.out = t;
    if (P.say && P.say.out && t - P.say.out > .45) P.say = null;
    P.S = S * (1 + .35 * P.z); P.dx = P.x; P.dy = P.y + Math.sin(t * 2.4) * 2; P.sp = sp;
    T.q.flashes = T.q.flashes.filter(f => t - f.t0 < .8);
    return true;
  },

  // ---------------- the tether + click-in flashes (drawn under the droid) ----------------
  drawTidy(ctx) {
    const P = this.probe, T = P && P.tidy; if (!T) return;
    const t = this.time;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    if (T.it && (T.phase === 'grab' || T.phase === 'tow' || T.phase === 'set')) {
      const L = T.lock ?? 1, x0 = P.dx, y0 = P.dy + P.S * .45, x1 = T.bx, y1 = T.by - (T.it.R || 30) * .92;
      const ex = x0 + (x1 - x0) * L, ey = y0 + (y1 - y0) * L;                  // the beam reaches down as it locks
      { // the tractor cone: from the droid's belly, widening to hug the load
        const r0 = P.S * .18, r1 = (T.it.R || 30) * .95 * L, dx = ex - x0, dy = ey - y0, d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d;
        const g = ctx.createLinearGradient(x0, y0, ex, ey); g.addColorStop(0, 'rgba(170,245,255,.34)'); g.addColorStop(1, `rgba(110,225,255,${(.1 + .05 * Math.sin(t * 9)).toFixed(3)})`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x0 + nx * r0, y0 + ny * r0); ctx.lineTo(ex + nx * r1, ey + ny * r1);
        ctx.quadraticCurveTo(ex + dx / d * r1 * .35, ey + dy / d * r1 * .35, ex - nx * r1, ey - ny * r1); ctx.lineTo(x0 - nx * r0, y0 - ny * r0); ctx.closePath(); ctx.fill();
        for (let k = 0; k < 4; k++) {                                         // rings sliding down the cone
          const u = (t * .9 + k / 4) % 1, cx = x0 + dx * u * L, cy = y0 + dy * u * L, rr = r0 + (r1 - r0) * u;
          ctx.strokeStyle = `rgba(200,250,255,${(.45 * Math.sin(u * Math.PI)).toFixed(3)})`; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.ellipse(cx, cy, rr, rr * .28, Math.atan2(ny, nx), 0, 6.283); ctx.stroke();
        }
      }
      for (const [w, a, c] of [[9, .12, '120,235,255'], [4, .3, '170,245,255'], [1.6, .9, '235,255,255']]) {
        ctx.strokeStyle = `rgba(${c},${(a * (.75 + .25 * Math.sin(t * 22))).toFixed(3)})`; ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(ex, ey); ctx.stroke();
      }
      for (let k = 0; k < 3; k++) {                                             // energy pulses running down the tether
        const u = ((t * 1.6 + k / 3) % 1) * L, px = x0 + (x1 - x0) * u, py = y0 + (y1 - y0) * u, r = 5;
        ctx.globalAlpha = .8; ctx.drawImage(glowSprite('#bff6ff'), px - r, py - r, r * 2, r * 2); ctx.globalAlpha = 1;
      }
      if (L > .6) {                                                             // the clamp ring around the load
        const R = (T.it.R || 30) * (1.18 + .1 * (1 - L)), k = .32;
        ctx.strokeStyle = `rgba(150,240,255,${(.55 * L).toFixed(3)})`; ctx.lineWidth = 1.6; ctx.setLineDash([6, 5]); ctx.lineDashOffset = -t * 30;
        ctx.beginPath(); ctx.ellipse(T.bx, T.by, R, R * k, 0, 0, 6.283); ctx.stroke(); ctx.setLineDash([]);
        ctx.globalAlpha = .25 * L; ctx.drawImage(glowSprite('#7fe8ff'), T.bx - R * 1.3, T.by - R * 1.3, R * 2.6, R * 2.6); ctx.globalAlpha = 1;
      }
    }
    for (const f of (this.probes || [P]).find(W => W.tidy && W.tidy.q === T.q) === P ? T.q.flashes : []) {                                                // click into place: a ring and a flash
      const u = (t - f.t0) / .8, R = f.R * (1.1 + .9 * u);
      ctx.globalAlpha = Math.pow(1 - u, 1.5) * .9; ctx.strokeStyle = 'rgba(190,250,255,1)'; ctx.lineWidth = 2 * (1 - u) + .5;
      ctx.beginPath(); ctx.arc(f.x, f.y, R, 0, 6.283); ctx.stroke();
      ctx.globalAlpha = Math.pow(1 - u, 2) * .6; ctx.drawImage(glowSprite('#e0fbff'), f.x - f.R * 1.6, f.y - f.R * 1.6, f.R * 3.2, f.R * 3.2);
    }
    ctx.restore();
  },
});

// the tether is drawn just before the droid itself (probeBody), so it hangs from under it; the tidy-up runs inside the
// probe's frame like probe-life.js (after it: grabbed / falling in still win)
{
  const life0 = Mesh.prototype.probeLife;
  Mesh.prototype.probeLife = function (P, dt, base) {
    this.probeTidyCheck(P);
    if (life0 && life0.call(this, P, dt, base)) return true;
    return this.probeTidyStep(P, dt, base);
  };
  const doing0 = Mesh.prototype.probeDoing;
  Mesh.prototype.probeDoing = function () { const P = this.probeState(); return P.tidy ? `Tidying up (${P.tidy.q.done}/${P.tidy.q.jobs.length})` : doing0.call(this); };
  const body0 = Mesh.prototype.probeBody;
  Mesh.prototype.probeBody = function (ctx, dt) { if (this.drawTidy) this.drawTidy(ctx); return body0.call(this, ctx, dt); };
}
