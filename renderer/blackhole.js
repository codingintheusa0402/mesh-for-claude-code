// The black hole (2026-10-27): the mesh's rubbish bin, bottom-left of the map. Drag a session's bubble right up to
// it and let go: the session gets /exit. Looks like Gargantua in Interstellar: a black shadow with a thin photon ring,
// a flat accretion disk seen almost edge-on (its near side crossing in front of the shadow), and the far side of the
// disk lensed up and over the top of the shadow (and a thin image of its underside below). Everything turns: the inner
// disk faster than the outer (Kepler), the near side brighter on the left where the gas comes toward you (Doppler).
// Drag a bubble close: the disk flares, the bubble starts to shed a stream of its own colour into the disk, a ring and
// "Release to end …" show where to let go. Drop it: a tidal disruption event, simulated (2026-10-27, "how a black hole
// really eats a star"): the bubble falls in on a near-parabolic orbit, stretching along the line to the hole; inside the
// tidal radius it's torn into a long thin stream — the debris gets a spread of orbital energy, so about half is bound
// and wraps round the hole while the other half is flung out as an escaping tail; the bound stream swings back past
// pericentre and crosses itself (shock flashes), circularises into a ring that feeds the disk and spirals in; nothing
// visibly "pops" at the horizon — matter reddens and fades as it sinks (gravitational redshift). The accretion flare
// rises as the debris falls in and fades slowly; at its peak a brief pair of polar jets. Once the bubble is fully torn
// apart /exit is sent; until then the Undo pill under the hole pulls it back out.
// Groups (portals) and view-only sessions can't go in (they bounce off). Loaded after organism.js / portal.js.

let BH_TILT = .1;                            // sin(elevation): the disk is seen almost edge-on (3-D: follows the live viewing angle)
const BH_SPIN_IN = .62, BH_SPIN_OUT = .2;     // rad/s, inner and outer disk (differential rotation)
const BH_GM = 60;                             // ambient gravity, × Rs³ (px³/s²)

// a streaky annulus (polar texture, drawn once): r0..1 of the radius, colour by radius, thin bright arcs + dark lanes
function bhAnnulus(D, r0, r1, n, pal, lanes, seed) {
  const c = document.createElement('canvas'); c.width = c.height = D; const x = c.getContext('2d'), h = D / 2;
  let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const g = x.createRadialGradient(h, h, r0 * h, h, h, r1 * h);
  g.addColorStop(0, `rgba(${pal[0]},.55)`); g.addColorStop(.35, `rgba(${pal[1]},.32)`); g.addColorStop(1, `rgba(${pal[2]},0)`);
  x.fillStyle = g; x.beginPath(); x.arc(h, h, r1 * h, 0, 6.283); x.arc(h, h, r0 * h, 0, 6.283, true); x.fill();
  x.globalCompositeOperation = 'lighter'; x.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const u = Math.pow(rnd(), 1.5), r = (r0 + (r1 - r0) * u) * h, a = rnd() * 6.283, L = .25 + rnd() * 1.9;
    const col = u < .3 ? pal[0] : u < .65 ? pal[1] : pal[2];
    x.strokeStyle = `rgba(${col},${(Math.pow(1 - u, 1.1) * (.06 + .3 * rnd())).toFixed(3)})`; x.lineWidth = (.5 + rnd() * 2.2) * D / 512;
    x.beginPath(); x.arc(h, h, r, a, a + L); x.stroke();
  }
  x.globalCompositeOperation = 'destination-out';                                  // dark dust lanes
  for (let i = 0; i < lanes; i++) {
    const r = (r0 + (r1 - r0) * rnd()) * h, a = rnd() * 6.283;
    x.strokeStyle = `rgba(0,0,0,${(.12 + .3 * rnd()).toFixed(3)})`; x.lineWidth = (1 + rnd() * 3) * D / 512;
    x.beginPath(); x.arc(h, h, r, a, a + .3 + rnd() * 1.4); x.stroke();
  }
  return c;
}

Object.assign(Mesh.prototype, {
  // where it sits (world coords) and how big: bottom-left of the window, clear of the orbit ring and the hint line
  bh3() { const B = window.Mesh3D && window.Mesh3D.bh; return B && B.ready ? B : null; },
  bhGeom() {
    // 3-D: Rs is the real shadow (critical impact parameter 3√3 M) and Ro the disk's visible edge (~16 M) at that scale
    const s = Math.max(.8, Math.min(1.25, Math.min(this.w, this.h) / 700)) * (this.lite ? .8 : 1), E = this.bh3();
    const R0 = (E ? 27 : 17) * s, Rs = R0 * (this.sizeOf ? this.sizeOf('bh') : 1), Ro = E ? Rs / 5.196 * 15.5 : Rs * 6.2, Ro0 = E ? R0 / 5.196 * 15.5 : R0 * 6.2;
    // a body in the orbit plane (handles.js planeSpot): out past the ring, bottom-left at rest (near side), carried round
    // by the system's spin; nearer = bigger
    const at = this.planeSpot ? this.planeSpot('bh', 2.45, 1.32) : { x: Math.max(Ro0 * 1.08, this.w * .1), y: this.h - Math.max(R0 * 4 + 46, this.h * .16), z: 0 };
    const pz = 1 + .22 * at.z;
    return { x: at.x, y: at.y, z: at.z, Rs: Rs * pz, Ro: Ro * pz, cap: Math.max(52, Rs * pz * 3.4) };
  },
  bhTex(Rs) {
    const k = Math.round(Rs * this.dpr());
    if (this.bhT && this.bhT.k === k) return this.bhT;
    const D = Math.min(1024, Math.max(256, Math.ceil(Rs * 6.6 * 2 * this.dpr() / 128) * 128));
    const warm = ['255,247,232', '255,214,158', '205,140,88'];
    return (this.bhT = {
      k,
      outer: bhAnnulus(D, .34, 1, this.lite ? 700 : 1500, warm, 120, 7),
      inner: bhAnnulus(D >> 1, .52, 1, this.lite ? 300 : 600, ['255,252,244', '255,232,190', '255,200,140'], 40, 11),
      lens: bhAnnulus(D >> 1, .45, 1, this.lite ? 350 : 700, ['255,250,240', '255,228,186', '226,170,110'], 50, 23),
    });
  },
  // per frame: the armed state while you drag a bubble near, the falling bubbles, the debris, the flare
  bhStep(dt) {
    const B = this.bhGeom(), d = this.drag, n = d && d.moved && !d.tilt && this.nodes.get(d.sid);
    let want = 0, dist = Infinity;
    if (n) { dist = Math.hypot(n.x - B.x, n.y - B.y); want = dist < B.cap ? 1 : dist < B.cap * 3 ? .25 * (1 - (dist - B.cap) / (B.cap * 2)) : 0; }
    const ok = n && this.bhCan(d);
    this.bhArmT = n && dist < B.cap && ok ? d.sid : null;
    this.bhNear = (this.bhNear || 0) + ((n ? 1 : 0) - (this.bhNear || 0)) * Math.min(1, dt * 4);   // hint shows while dragging
    this.bhArm = (this.bhArm || 0) + ((ok ? want : want * .3) - (this.bhArm || 0)) * Math.min(1, dt * 5);
    this.bhFeed = (this.bhFeed || 0) * Math.pow(.62, dt);                     // the accretion flare: rises as debris falls in, long fade
    this.bhFlash = this.bhFeed;
    const P = this.bhP || (this.bhP = []), Rs = B.Rs;
    // armed: tidal stripping already — a thin stream leaves the near side of the bubble toward the hole
    if (this.bhArmT && n) this.bhStrip(n, B, dt * 30);
    // eaten bubbles: fall in on their orbit, stretch, get torn apart
    for (const m of this.nodes.values()) {
      const E = m.eaten; if (!E || E.done) continue;
      const age = this.time - E.t0;
      for (let i = 0; i < 4; i++) {                                              // orbit (4 sub-steps), a little drag so it doesn't fly back out
        const h = dt / 4, r = Math.hypot(E.x, E.z), a = E.gm / Math.pow(r * r + Rs * Rs * .1, 1.5);
        E.vx -= E.x * a * h; E.vz -= E.z * a * h;
        const vr = (E.vx * E.x + E.vz * E.z) / r; if (vr > 0) { E.vx -= E.x / r * vr * h * 2.5; E.vz -= E.z / r * vr * h * 2.5; }
        E.x += E.vx * h; E.z += E.vz * h;
      }
      E.b += (1 - E.b) * Math.min(1, dt * 2.2);                                    // it settles into the disk plane as it falls
      const r = Math.hypot(E.x, E.z);
      if (!E.torn && (r < E.rt || age > .45)) { E.torn = this.time; }
      if (E.torn) {                                                               // being torn apart: mass streams off, fastest near pericentre
        const rate = (.7 + 1.6 * Math.min(1, E.rt / r)) * dt, before = E.mass;
        E.mass = Math.max(0, E.mass - rate);
        this.bhDebris(m, E, B, (before - E.mass) * (this.lite ? 150 : 300));
      }
      const q = this.bhPr(E.x, E.z, E.b), q2 = this.bhPr(E.x + E.vx * .02, E.z + E.vz * .02, E.b);
      m.x = B.x + q[0]; m.y = B.y + q[1]; m.vx = m.vy = 0; m.z = q[2] >= 0 ? .2 : -.2;
      const tid = Math.min(3.2, Math.pow(E.rt / Math.max(r, Rs), 1.5));
      m.bhScale = Math.sqrt(E.mass); m.bhStretch = { a: Math.atan2(q2[1] - q[1], q2[0] - q[0]), k: 1 + tid + 2.2 * (1 - E.mass), far: q[2] < 0, B };
      if (E.mass <= .03) this.bhSwallow(m, B);
    }
    // the probes falling in (probe-life.js): the same fall and tear, drawn as the droid itself — every probe on the crew
    // (2026-10-30: a crew probe's fall used to freeze, since only this.probe's was advanced)
    for (const FP of (this.probes || [this.probe]).slice()) { const keep = this.probe; this.probe = FP; const PF = FP && FP.fall; try {
      if (PF && !PF.done) {
        const age = this.time - PF.t0;
        for (let i = 0; i < 4; i++) {
          const h = dt / 4, r = Math.hypot(PF.x, PF.z), a = PF.gm / Math.pow(r * r + Rs * Rs * .1, 1.5);
          PF.vx -= PF.x * a * h; PF.vz -= PF.z * a * h;
          const vr = (PF.vx * PF.x + PF.vz * PF.z) / r; if (vr > 0) { PF.vx -= PF.x / r * vr * h * 2.5; PF.vz -= PF.z / r * vr * h * 2.5; }
          PF.x += PF.vx * h; PF.z += PF.vz * h;
        }
        PF.b += (1 - PF.b) * Math.min(1, dt * 2.2);
        const r = Math.hypot(PF.x, PF.z);
        if (!PF.torn && (r < PF.rt || age > .45)) PF.torn = this.time;
        if (PF.torn) { const before = PF.mass; PF.mass = Math.max(0, PF.mass - (.7 + 1.6 * Math.min(1, PF.rt / r)) * dt * .45); this.bhDebris(null, PF, B, (before - PF.mass) * (this.lite ? 120 : 220)); }   // (the probe tears a little slower: you see it go)
        const q = this.bhPr(PF.x, PF.z, PF.b); PF.sx = B.x + q[0]; PF.sy = B.y + q[1]; PF.far = q[2] < 0;
        if (PF.mass <= .03) { PF.done = true; if (this.probeDie) this.probeDie('blackhole'); }
      }
    } finally { this.probe = keep; } }
    // the debris: gravity (+ circularisation for the bound part), swallowed at the horizon
    let fed = 0;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i]; p.age += dt;
      for (let j = 0; j < 3; j++) {
        const h = dt / 3, r = Math.hypot(p.x, p.z), a = p.gm / Math.pow(r * r + Rs * Rs * .05, 1.5);
        p.vx -= p.x * a * h; p.vz -= p.z * a * h;
        if (p.bound && p.age > p.circ) {                                          // the bound stream settles into the disk, drifting in
          const vc = Math.sqrt(p.gm / r) * .9, tx = -p.z / r * p.dir, tz = p.x / r * p.dir, c = Math.min(1, h * 1.3);
          p.vx += (tx * vc - p.vx) * c; p.vz += (tz * vc - p.vz) * c;
        }
        const vr = (p.vx * p.x + p.vz * p.z) / r;
        if (p.bound && p.pv < 0 && vr >= 0 && p.age > .35 && p.ev) this.bhCross(p, B);   // back past pericentre: the stream hits itself
        p.pv = vr; p.x += p.vx * h; p.z += p.vz * h;
      }
      p.b += (1 - p.b) * Math.min(1, dt * 1.8);
      const r = Math.hypot(p.x, p.z);
      if (r < Rs * 1.04) { fed++; P.splice(i, 1); continue; }
      if (p.age > (p.bound ? 9 : 3.2) || r > B.Ro * 2.2) P.splice(i, 1);
    }
    if (fed) {
      this.bhFeed = Math.min(1.6, this.bhFeed + fed * .012);
      if (this.bhFeed > .7 && this.time - (this.bhJetAt || -9) > 4) { this.bhJetAt = this.time; (this.bhJets || (this.bhJets = [])).push({ t0: this.time, col: '220,235,255' }); }
    }
    // ambient: specks from the outer disk now and then, spiralling down
    this.bhAcc = (this.bhAcc || 0) + dt * (this.lite ? 3 : 7) * (1 + this.bhArm * 2);
    while (this.bhAcc >= 1) {
      this.bhAcc--; const r = B.Ro * (.65 + Math.random() * .3), a = Math.random() * 6.283, gm = BH_GM * Rs * Rs * Rs, v = Math.sqrt(gm / r) * .92;
      P.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, vx: -Math.sin(a) * v, vz: Math.cos(a) * v, b: 1, gm, dir: 1, age: 0, circ: 0, bound: true, col: Math.random() < .5 ? '255,236,200' : '255,206,150', w: .7 });
    }
    if (P.length > 1400) P.splice(0, P.length - 1400);
    if (this.bhJets) this.bhJets = this.bhJets.filter(j => this.time - j.t0 < 1.6);
    if (this.bhXs) this.bhXs = this.bhXs.filter(f => this.time - f.t0 < .9);
    this.bhSweep();
  },
  // the view (3-D): a camera orientation round the hole — three unit vectors in the disk's frame (disk in xz, pole +y).
  // Base: ~81° off the pole with a slow drift; times however you've turned it (⌘-drag: sideways spins it round the
  // screen's vertical, up/down round its horizontal — all the way round, every side)
  bhCamera() {
    // (tilts with the orbit plane too: dragging the spin band up/down tips the whole system, the hole with it)
    const i = 1.415 + .07 * Math.sin(this.time * .09) - (this.sysTilt || 0), c = Math.cos(i), s = Math.sin(i), M = this.bhM || [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const mul = v => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
    // a body in the orbit plane: the system's spin turns it about the plane's normal (0, cos e, sin e in screen space,
    // sin e = k), a tilt pitches it about the screen's horizontal — applied to the camera frame as the inverse turn
    let C = { fw: mul([0, -c, -s]), rt: mul([1, 0, 0]), up: mul([0, s, -c]) };
    const rotAx = (v, a, th) => { const ct = Math.cos(th), st = Math.sin(th), d = a[0] * v[0] + a[1] * v[1] + a[2] * v[2];
      const cx = a[1] * v[2] - a[2] * v[1], cy = a[2] * v[0] - a[0] * v[2], cz = a[0] * v[1] - a[1] * v[0];
      return [v[0] * ct + cx * st + a[0] * d * (1 - ct), v[1] * ct + cy * st + a[1] * d * (1 - ct), v[2] * ct + cz * st + a[2] * d * (1 - ct)]; };
    const k = this.orbitShape ? this.orbitShape().k : .4, ce = Math.sqrt(Math.max(0, 1 - k * k)), rot = this.sysRot || 0, tl = this.sysTilt || 0;
    const n = [C.up[0] * ce - C.fw[0] * k, C.up[1] * ce - C.fw[1] * k, C.up[2] * ce - C.fw[2] * k];   // the plane's normal, in the disk's frame
    C = { fw: rotAx(C.fw, n, rot), rt: rotAx(C.rt, n, rot), up: rotAx(C.up, n, rot) };
    const ax = C.rt; C = { fw: rotAx(C.fw, ax, -tl), rt: C.rt, up: rotAx(C.up, ax, -tl) };
    return C;
  },
  bhRotate(dx, dy) {
    const rot = (a, t) => { const [x, y, z] = a, c = Math.cos(t), s = Math.sin(t), C = 1 - c;
      return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C]; };
    const mm = (A, B) => [0, 1, 2].flatMap(r => [0, 1, 2].map(c => A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]));
    let C = this.bhCamera(); this.bhM = mm(rot(C.up, -dx * .01), this.bhM || [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    C = this.bhCamera(); this.bhM = mm(rot(C.rt, -dy * .01), this.bhM);
  },
  // a point in the disk plane (x, z; px from the hole) → screen offset + depth toward you (>0 = near side);
  // b blends from the screen plane (0: where a bubble was let go) into the disk plane (1)
  bhPr(x, z, b) {
    const T = this.bhT3 || { a: 1, b: 0, c: 0, d: BH_TILT, e: 0, f: 1 }, px = T.a * x + T.b * z, py = T.c * x + T.d * z;
    return [x + (px - x) * b, z + (py - z) * b, b < .5 ? z : T.e * x + T.f * z];
  },
  bhCan(d) {
    if (!d || d.pick.startsWith('grp:')) return false;
    const n = this.nodes.get(d.sid); return !!(n && !n.gslot && !(n.s && n.s.group) && !n.eaten);
  },
  // armed, not yet dropped: a thin stream peels off the side of the bubble facing the hole
  bhStrip(n, B, count) {
    const P = this.bhP, col = this.bhColor(n), R = this.nodeRadius(n) * (n.gscale ?? 1), Rs = B.Rs, gm = BH_GM * Rs * Rs * Rs;
    this.bhShedAcc = (this.bhShedAcc || 0) + count;
    while (this.bhShedAcc >= 1) {
      this.bhShedAcc--;
      const dx = n.x - B.x, dy = n.y - B.y, d = Math.hypot(dx, dy) || 1, x = dx - dx / d * R * .9, z = dy - dy / d * R * .9, r = Math.hypot(x, z) || 1, v = Math.sqrt(gm / r) * .5;
      P.push({ x, z, vx: -z / r * v, vz: x / r * v, b: 0, gm, dir: 1, age: 0, circ: .3, bound: true, col, w: 1 });
    }
  },
  // torn-off debris: the side of the bubble nearer the hole gets less orbital energy (bound), the far side more (unbound)
  bhDebris(m, E, B, count) {
    const P = this.bhP, R = (E.R || this.nodeRadius(m) * (m.gscale ?? 1)) * Math.max(.4, Math.sqrt(E.mass)), r = Math.hypot(E.x, E.z) || 1, ux = E.x / r, uz = E.z / r;
    const sp = Math.hypot(E.vx, E.vz) || 1, vx = E.vx / sp, vz = E.vz / sp;
    E.acc = (E.acc || 0) + count;
    while (E.acc >= 1) {
      E.acc--;
      const u = Math.random() * 2 - 1, j = (Math.random() - .5) * .35;            // along the line to the hole / across it
      const x = E.x + ux * u * R + -uz * j * R, z = E.z + uz * u * R + ux * j * R, f = 1 + u * .2 + (Math.random() - .5) * .03;
      P.push({ x, z, vx: E.vx * f, vz: E.vz * f, b: E.b, gm: E.gm, dir: E.dir, age: 0, circ: .9 + Math.random() * .6, bound: u < 0, pv: -1, ev: E, col: E.col, w: 1 });
    }
  },
  // the returning stream crossing itself: a shock flash where it happens (a few per event)
  bhCross(p, B) {
    const E = p.ev; if ((E.flashes || 0) >= 6 || this.time - (E.flashAt || -9) < .22) return;
    E.flashes = (E.flashes || 0) + 1; E.flashAt = this.time; this.bhFeed = Math.min(1.6, (this.bhFeed || 0) + .12);
    (this.bhXs || (this.bhXs = [])).push({ x: p.x, z: p.z, b: p.b, t0: this.time, col: p.col });
  },
  bhColor(n) {
    const s = n.s || {}, fam = s.color && ORB_PAL[s.color] ? s.color : s.serverUses ? 'server' : ORB_PAL[s.family] ? s.family : 'other';
    const h = ((ORB_PAL[fam] || {}).rim || '#bfe8ff').replace('#', ''), v = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return `${(v >> 16) & 255},${(v >> 8) & 255},${v & 255}`;
  },
  // the probe dropped on it / strayed too close (probe-life.js): it falls in like a bubble
  bhSwallowProbe(P, B) {
    const Rs = B.Rs; let x = P.x - B.x, z = P.y - B.y, r = Math.hypot(x, z);
    if (r < Rs * 2.6) { const a = r > 1 ? Math.atan2(z, x) : -2.4; r = Rs * 2.6; x = Math.cos(a) * r; z = Math.sin(a) * r; }
    const gm = Math.max(40 * Rs * Rs * Rs, 1.23 * r * r * r), rp = Rs * 1.9, v = Math.sqrt(2 * gm / r), vt = Math.sqrt(2 * gm * rp) / r, vr = -Math.sqrt(Math.max(0, v * v - vt * vt)) * .55;
    const h = (P.hue || 0) * Math.PI / 180, c = [120, 190, 255].map((_, i) => Math.round(150 + 100 * Math.cos(h + 3.5 + i * 2.1)));   // its paint colour, roughly
    P.fall = { t0: this.time, x, z, vx: x / r * vr - z / r * vt, vz: z / r * vr + x / r * vt, b: 0, gm, dir: 1, mass: 1, rt: Math.max(Rs * 2.4, r * .8), col: c.join(','), R: (P.S || 30) * .55, sx: P.x, sy: P.y };
    P.held = null; P.grav = null;
    P.say = { text: probeLine('hole', ['Nooo — not the hole! Not again!', 'Tell the warden I tried to go straight…', 'Aaaah! Fuck you, motherfuuuu—!']), health: 'error', name: 'Probe', t0: this.time, hold: this.time + 2.2 };
  },
  // fully torn apart: /exit (unless it was undone); the debris keeps falling in on its own
  bhSwallow(n, B) {
    const E = n.eaten; E.done = true; n.bhScale = 0;
    this.bhUndoHide();
    if (this.onTrash) this.onTrash(n.sid, 'send');
    E.gone = this.time;                                                        // stays hidden; back out if it never exits
  },
  // dropped: take it if it's over the hole and allowed (bubbles.js dragEnd asks first)
  bhDrop(n, d) {
    if (this.compact || this.bhArmT !== d.sid) {
      if (n && this.drag === null && !this.bhCan(d)) {                         // a group / view-only session dropped right on it: bounce off
        const B = this.bhGeom(), dist = Math.hypot(n.x - B.x, n.y - B.y);
        if (dist < B.cap) { n.vx += (n.x - B.x) / (dist || 1) * 520; n.vy += (n.y - B.y) / (dist || 1) * 520 - 200; this.onTrash && this.onTrash(d.pick, 'refuse'); }
      }
      return false;
    }
    const ok = this.onTrash ? this.onTrash(n.sid, 'check') : true;
    if (ok !== true) { const B = this.bhGeom(); n.vx += (n.x - B.x) * 6; n.vy += (n.y - B.y) * 6 - 260; return false; }   // view-only: spat back
    this.bhFall(n); this.bhUndoShow(n);
    return true;
  },
  // the cleanup (cleanup.js) feeds it sessions directly; false when it isn't on screen to do so
  bhSwallow(sid) {
    const n = this.nodes.get(sid), box = this.c.getBoundingClientRect();
    if (!n || n.eaten || this.compact || this.paused || this.off('mBlackHole') || !box.width || document.hidden || (n.gscale ?? 1) < .45) return false;
    this.bhFall(n); return true;
  },
  bhFall(n) {
    // its fall: from where it was let go, a near-parabolic orbit with pericentre just outside the shadow, timed to take
    // about a second (gravity scaled to the drop distance); tidal radius a little inside the drop point
    const B = this.bhGeom(), Rs = B.Rs; let x = n.x - B.x, z = n.y - B.y, r = Math.hypot(x, z);
    if (r < Rs * 2.6) { const a = r > 1 ? Math.atan2(z, x) : -2.4; r = Rs * 2.6; x = Math.cos(a) * r; z = Math.sin(a) * r; }
    const gm = Math.max(40 * Rs * Rs * Rs, 1.23 * r * r * r), rp = Rs * 1.9, v = Math.sqrt(2 * gm / r), vt = Math.sqrt(2 * gm * rp) / r, vr = -Math.sqrt(Math.max(0, v * v - vt * vt)) * .55;
    n.dragging = true;
    n.eaten = { t0: this.time, x, z, vx: x / r * vr - z / r * vt, vz: z / r * vr + x / r * vt, b: 0, gm, dir: 1, mass: 1, rt: Math.max(Rs * 2.4, r * .8), col: this.bhColor(n) };
  },
  // Undo (before the horizon) / a session that never went away: back out to just above the hole, onto an orbit there
  bhRelease(n) {
    const B = this.bhGeom(), E = n.eaten;
    if (E && this.bhP) this.bhP = this.bhP.filter(p => p.ev !== E);                // pulled back out: its torn-off debris goes too
    n.eaten = null; n.bhScale = 1; n.bhStretch = null; n.dragging = false;
    const x = n.x, y = n.y; n.x = B.x + B.cap * 1.6; n.y = B.y - B.cap * 2.2; this.dropOrbit(n); n.x = x; n.y = y;
    n.vx = (n.x - B.x) * 3; n.vy = -320;
  },
  bhUndoShow(n) {
    let el = this.bhUndoEl;
    if (!el) {
      el = this.bhUndoEl = document.createElement('div'); el.className = 'bh-undo';
      el.innerHTML = '<span></span><button type="button">Undo</button>';
      if (!document.getElementById('bhCss')) {
        const st = document.createElement('style'); st.id = 'bhCss';
        st.textContent = `.bh-undo { position: fixed; z-index: 29; display: flex; align-items: center; gap: 10px; padding: 5px 6px 5px 12px; border-radius: 999px;
  background: rgba(14,10,6,.86); border: 1px solid rgba(255,214,158,.45); color: #ffe9cc; font: 500 12px/16px -apple-system, system-ui, sans-serif;
  box-shadow: 0 4px 18px rgba(0,0,0,.5); white-space: nowrap; transform: translate(-50%, 0); }
.bh-undo span { max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.bh-undo.bh-undo button { padding: 3px 12px; border-radius: 999px; border: 0; background: #ffd79e; color: #2a1606; font: 600 12px/16px -apple-system, system-ui, sans-serif; cursor: pointer; box-shadow: none; }
.bh-undo.bh-undo button:hover { background: #fff0d6; }`;
        document.head.appendChild(st);
      }
      el.querySelector('button').addEventListener('click', e => {
        e.stopPropagation();
        const m = this.nodes.get(el.dataset.sid); if (m && m.eaten && !m.eaten.done) this.bhRelease(m);
        this.bhUndoHide();
      });
      el.addEventListener('pointerdown', e => e.stopPropagation());
      this.c.parentElement.appendChild(el);
    }
    el.dataset.sid = n.sid;
    const nm = String((n.s && n.s.name) || 'session');
    el.querySelector('span').textContent = `Ending ${nm.length > 26 ? nm.slice(0, 25) + '…' : nm}`;
    el.style.display = 'flex';
  },
  bhUndoHide() { if (this.bhUndoEl) this.bhUndoEl.style.display = 'none'; },

  bhDiskFrame(B, k, aIn, aOut, gain) {
    const T = this.bhTex(B.Rs), d = this.dpr(), Ro = B.Ro, w = Ro * 2.04, h = Math.ceil(Ro * k * 2 + 6) & ~1;
    let D = this.bhDisk;
    if (!D || D.w !== w || D.h !== h || D.d !== d) {
      const mk = () => { const c = document.createElement('canvas'); c.width = Math.ceil(w * d); c.height = Math.ceil(h * d); return c; };
      D = this.bhDisk = { c: mk(), c2: mk(), w, h, d };
    }
    const paint = (c, alpha) => {
      const x = c.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, w, h);
      x.translate(w / 2, h / 2); x.scale(1, k); x.globalAlpha = alpha;
      x.save(); x.rotate(-aOut); x.drawImage(T.outer, -Ro, -Ro, Ro * 2, Ro * 2); x.restore();
      const Ri = Ro * .48; x.save(); x.rotate(-aIn); x.drawImage(T.inner, -Ri, -Ri, Ri * 2, Ri * 2); x.restore();
      return x;
    };
    const m = paint(D.c, Math.min(1, gain));
    const x2 = paint(D.c2, 1);                                                    // Doppler: the same disk, faded out left → right …
    x2.setTransform(d, 0, 0, d, 0, 0); x2.globalAlpha = 1; x2.globalCompositeOperation = 'destination-in';
    const g = x2.createLinearGradient(0, 0, w, 0); g.addColorStop(0, 'rgba(0,0,0,.6)'); g.addColorStop(.45, 'rgba(0,0,0,.28)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x2.fillStyle = g; x2.fillRect(0, 0, w, h);
    m.setTransform(1, 0, 0, 1, 0, 0); m.globalAlpha = Math.min(1, .8 * gain); m.globalCompositeOperation = 'lighter'; m.drawImage(D.c2, 0, 0);   // … added on top
  },
  // ---- drawing: 'back' goes before the bubbles (glow, far disk, lensed arcs, the shadow), 'front' after them
  drawBlackHole(ctx, layer, dt, pass = 'far') {                                 // 'back' runs twice: pass 'far' (before the star) and 'near' (after it)
    if (this.compact || this.off('mBlackHole')) {
      this.bhUndoHide(); this.bhArmT = null; this.bhArm = this.bhNear = 0;
      for (const n of this.nodes.values()) if (n.eaten && !n.eaten.done) this.bhRelease(n);   // a bubble mid-fall comes back out (no /exit)
      for (const FP of (this.probes || [this.probe]).slice()) if (FP && FP.fall && !FP.fall.done) { const keep = this.probe; this.probe = FP; FP.fall.done = true; if (this.probeDie) this.probeDie('blackhole'); this.probe = keep; }
      return;
    }
    const E3 = this.bh3(), B = this.bhGeom(), { x, y, Rs, Ro } = B, t = this.time, T = E3 ? null : this.bhTex(Rs), A = this.bhArm || 0, F = this.bhFlash || 0;
    const gain = 1 + .55 * A + 1.2 * F;
    // 3-D: seen from ~81° off the disk's pole, drifting a few degrees, plus however far you've tilted it by dragging
    const C = E3 ? this.bhCamera() : null, k = E3 ? Math.hypot(C.up[0], C.up[2]) : BH_TILT + .008 * Math.sin(t * .21);
    if (layer === 'back' && pass === 'far') this.bhT3 = E3 ? { a: C.rt[0], b: C.rt[2], c: -C.up[0], d: -C.up[2], e: -C.fw[0], f: -C.fw[2], pole: [C.rt[1], -C.up[1]] } : null;
    if (layer === 'back' && pass === 'far') this.bhStep(dt);
    const V = this.view(), onScreen = x + Ro * 1.3 > V.x0 && x - Ro * 1.3 < V.x1 && y + Ro * 1.3 > V.y0 && y - Ro * 1.3 < V.y1;
    // re-traced ~12×/s when calm (the disk turns slowly), every frame only while it flares / something is near it
    const lively = A > .05 || F > .05, due = !this.bhImg || lively || this.time - (this.bhAt || 0) > 1 / 12;
    if (E3 && layer === 'back' && pass === 'far' && (onScreen || !this.bhImg) && due) {   // ray-traced (three3d.js): one image, all of it (not re-rendered while off the view)
      this.bhAt = this.time;
      this.bhPhase = (this.bhPhase || 0) + dt * .2 * (1 + 1.5 * A);
      const T = this.bhT3, u = Ro / 15.5, W = 2 * u * Math.max(11.5, 16.5 * Math.hypot(T.a, T.b) + 7.5), H = 2 * u * Math.max(11.5, 16.5 * Math.hypot(T.c, T.d) + 7.5), q = (this.lite ? 1 : Math.min(1.4, this.dpr() * Math.min(1.4, this.cam ? this.cam.s : 1), 800 / Math.max(W, H))) * .6;   // (sized to the disk as it's seen now; traced at 0.6× and upscaled — its glow hides it; a big hole is capped)
      // the traced buffer snaps to 32 px steps (three3d.js) — the drawn box is widened to match, so nothing stretches
      const cw = Math.max(32, Math.ceil(W * q / 32) * 32), ch = Math.max(32, Math.ceil(H * q / 32) * 32);
      this.bhImg = { cv: E3.render({ w: cw, h: ch, k: Rs / 5.196 * q, cam: C, phase: this.bhPhase, gain }), W: cw / q, H: ch / q, q };
      // its glow, made once per trace: the image shrunk to a tiny canvas and stretched back (a free blur)
      if (!this.lite) {
        const g = this.bhGlow || (this.bhGlow = [document.createElement('canvas'), document.createElement('canvas')]), cv = this.bhImg.cv;
        [[g[0], 8], [g[1], 22]].forEach(([c, f]) => { const w = Math.max(2, Math.round(cv.width / f)), h = Math.max(2, Math.round(cv.height / f)); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } const x2 = c.getContext('2d'); x2.clearRect(0, 0, w, h); x2.imageSmoothingQuality = 'high'; x2.drawImage(cv, 0, 0, w, h); });
      }
    }
    const aIn = t * BH_SPIN_IN * (1 + 1.5 * A), aOut = t * BH_SPIN_OUT * (1 + 1.5 * A);
    // the whole disk, drawn once a frame off-screen in its plane (inner faster than outer), the left side brightened
    // on a smooth gradient (Doppler); then its far half goes behind the shadow and its near half in front of it
    if (layer === 'back' && pass === 'far' && !E3) this.bhDiskFrame(B, k, aIn, aOut, gain);
    const disk = near => {
      const D = this.bhDisk; if (!D) return;
      const hw = D.w / 2, hh = D.h / 2;
      ctx.drawImage(D.c, 0, near ? D.c.height / 2 : 0, D.c.width, D.c.height / 2, x - hw, near ? y : y - hh, D.w, hh);
    };
    if (layer === 'back' && (B.z < 0) !== (pass === 'far')) return;             // drawn on its side of the star
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    if (layer === 'back' && E3) {
      ctx.globalAlpha = Math.min(1, (.12 + .05 * Math.sin(t * .8)) * gain); ctx.drawImage(glowSprite('#ffcf8a'), x - Ro * 1.1, y - Ro * .45, Ro * 2.2, Ro * .9);
      const I = this.bhImg; ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      ctx.drawImage(I.cv, x - I.W / 2, y - I.H / 2, I.W, I.H);
      // bloom: the same image blurred on top, a tight glow and a wide one (Gargantua glows)
      if (!this.lite && this.bhGlow) {
        ctx.globalCompositeOperation = 'lighter'; ctx.imageSmoothingQuality = 'high';
        for (const [c, al, sp] of [[this.bhGlow[0], .4, 1.04], [this.bhGlow[1], .26, 1.12]]) { ctx.globalAlpha = al * Math.min(1.6, gain); ctx.drawImage(c, x - I.W * sp / 2, y - I.H * sp / 2, I.W * sp, I.H * sp); }
      }
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1; this.bhParticles(ctx, B, false);
    } else if (layer === 'back') {
      // warm haze around it
      ctx.globalAlpha = Math.min(1, (.2 + .1 * Math.sin(t * .8)) * gain); ctx.drawImage(glowSprite('#ffcf8a'), x - Ro * 1.15, y - Ro * .5, Ro * 2.3, Ro);
      ctx.globalAlpha = Math.min(1, .3 * gain); ctx.drawImage(glowSprite('#ffe6c0'), x - Rs * 3.4, y - Rs * 3.4, Rs * 6.8, Rs * 6.8);
      disk(false);
      this.bhParticles(ctx, B, false);
      // the far disk lensed over the top of the shadow (thick hump), and its underside as a thin ring below
      ctx.globalAlpha = Math.min(1, .5 * gain); ctx.drawImage(glowSprite('#ffe2b8'), x - Rs * 2.6, y - Rs * 2.5, Rs * 5.2, Rs * 3.4);
      ctx.save(); ctx.beginPath(); ctx.rect(x - Rs * 2.6, y - Rs * 2.6, Rs * 5.2, Rs * 2.6); ctx.clip();
      ctx.translate(x, y); ctx.scale(1.04, .92); ctx.rotate(aIn * .8); ctx.globalAlpha = Math.min(1, gain);
      ctx.drawImage(T.lens, -Rs * 2.3, -Rs * 2.3, Rs * 4.6, Rs * 4.6); ctx.rotate(1.3); ctx.globalAlpha = Math.min(1, .6 * gain);
      ctx.drawImage(T.lens, -Rs * 2.15, -Rs * 2.15, Rs * 4.3, Rs * 4.3); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.rect(x - Rs * 1.6, y + Rs * .2, Rs * 3.2, Rs * 1.6); ctx.clip();
      ctx.translate(x, y); ctx.rotate(-aIn * .8); ctx.globalAlpha = Math.min(1, .7 * gain);
      ctx.drawImage(T.lens, -Rs * 1.32, -Rs * 1.32, Rs * 2.64, Rs * 2.64); ctx.restore();
      // the shadow: blacker than the sky, a hint of blue at the rim
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      const g = ctx.createRadialGradient(x, y - Rs * .15, 0, x, y, Rs);
      g.addColorStop(0, '#000'); g.addColorStop(.8, '#010205'); g.addColorStop(1, '#0a1220');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, Rs, 0, 6.283); ctx.fill();
      // photon ring: a hairline of light, flickering a touch
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(255,246,228,${Math.min(1, (.55 + .12 * Math.sin(t * 5.3) + .3 * A + .5 * F)).toFixed(3)})`; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.arc(x, y, Rs * 1.03, 0, 6.283); ctx.stroke();
      ctx.strokeStyle = `rgba(255,220,170,${(.18 + .2 * A).toFixed(3)})`; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.arc(x, y, Rs * 1.06, 0, 6.283); ctx.stroke();
    } else {
      if (!E3) disk(true);                                                       // the near side, across the shadow
      else if (false) {
        // something's falling in: the near half of the disk goes over it again (it was drawn before the bubbles)
        const I = this.bhImg, hs = (Math.abs(k) * Ro + 4), top = k >= 0 ? y : y - hs;
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(I.cv, 0, (top - (y - I.H / 2)) * I.q, I.cv.width, hs * I.q, x - I.W / 2, top, I.W, hs);
        ctx.globalCompositeOperation = 'lighter';
      }
      this.bhParticles(ctx, B, true);
      // jets + shock ring when something crosses the horizon
      for (const j of this.bhJets || []) {
        const u = (t - j.t0) / 1.6, a = .6 * Math.pow(1 - u, 1.6) * Math.min(1, u * 6), L = Ro * (.5 + 1.2 * Math.min(1, u * 2.5)) * Math.max(.15, Math.hypot(...(this.bhT3 && this.bhT3.pole || [0, 1])));
        const pl = this.bhT3 && this.bhT3.pole || [0, -1], pk = Math.hypot(pl[0], pl[1]) || 1;   // along the pole as it's seen now
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(-pl[0], -pl[1])); ctx.translate(-x, -y);
        for (const sg of [-1, 1]) {                                              // thin, tapering, a bright core in a soft sheath
          const gr = ctx.createLinearGradient(x, y, x, y + sg * L); gr.addColorStop(0, `rgba(235,245,255,${a * .75})`); gr.addColorStop(.35, `rgba(${j.col},${a * .4})`); gr.addColorStop(1, `rgba(${j.col},0)`);
          ctx.fillStyle = gr;
          for (const [w0, w1, al] of [[.32, .1, .45], [.12, .02, 1]]) {
            ctx.globalAlpha = al; ctx.beginPath(); ctx.moveTo(x - Rs * w0, y); ctx.lineTo(x + Rs * w0, y); ctx.lineTo(x + Rs * w1, y + sg * L); ctx.lineTo(x - Rs * w1, y + sg * L); ctx.closePath(); ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
        ctx.restore();
      }
      if (F > .02) { ctx.globalAlpha = Math.min(.8, F * .5); ctx.drawImage(glowSprite('#fff0d8'), x - Rs * 3.5, y - Rs * 3.5, Rs * 7, Rs * 7); }   // the flare
      // where to let go, while a bubble is dragged near
      const near = this.bhNear || 0, hov = this.cursor.in && Math.hypot(this.cursor.x - x, this.cursor.y - y) < B.cap;
      if (near > .02 || hov) {
        ctx.globalCompositeOperation = 'source-over';
        const armed = !!this.bhArmT, al = Math.max(near * (.35 + .65 * Math.min(1, A * 1.5)), hov ? .6 : 0);
        ctx.globalAlpha = al; ctx.setLineDash([3, 6]); ctx.lineDashOffset = -t * 18;
        ctx.strokeStyle = armed ? 'rgba(255,190,120,.95)' : 'rgba(255,236,210,.5)'; ctx.lineWidth = armed ? 1.6 : 1;
        ctx.beginPath(); ctx.arc(x, y, B.cap * (armed ? 1 + .04 * Math.sin(t * 8) : 1), 0, 6.283); ctx.stroke(); ctx.setLineDash([]);
        const d = this.drag, nm = d && this.nodes.get(d.sid) && this.nodes.get(d.sid).s ? String(this.nodes.get(d.sid).s.name || 'session') : '';
        const txt = armed ? `Release to end ${nm.length > 22 ? nm.slice(0, 21) + '…' : nm}` : d && d.moved && !this.bhCan(d) ? 'Groups and view-only sessions can\'t go in' : 'Drop a session here to end it (/exit) · ⌘-drag to turn';
        ctx.font = `${armed ? 600 : 500} 11px -apple-system, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillStyle = armed ? '#ffd9a8' : 'rgba(255,236,210,.85)'; ctx.fillText(txt, x, y + B.cap + 8);
      }
    }
    ctx.restore();
    if (layer === 'front') this.bhUndoPlace(B);
  },
  // the debris: streaks along their velocity, far half behind the shadow, near half in front; hot white close in,
  // reddening and fading as it sinks toward the horizon (gravitational redshift); the stream's shock flashes
  bhParticles(ctx, B, near) {
    const P = this.bhP || [], Rs = B.Rs;
    ctx.lineCap = 'round';
    for (const p of P) {
      const q = this.bhPr(p.x, p.z, p.b); if ((q[2] >= 0) !== near) continue;
      const x = B.x + q[0], y = B.y + q[1];
      if (!near && Math.hypot(x - B.x, y - B.y) < Rs * 1.02) continue;              // hidden by the shadow
      const r = Math.hypot(p.x, p.z), red = Math.min(1, Math.max(0, (r - Rs) / (Rs * .9)));
      const f = Math.min(1, p.age * 5) * red * (p.bound ? 1 : Math.max(0, 1 - p.age / 3.2)) * (p.w < 1 ? .5 : 1);
      if (f < .02) continue;
      const hot = Math.max(0, Math.min(1, (Rs * 3.4 - r) / (Rs * 2)));
      const c = String(p.col || '255,236,200').split(',').map(Number), w = [255, 246, 230], rr = [255, 96, 46];
      const col = c.map((v, i) => Math.round((v + (w[i] - v) * hot) * red + rr[i] * (1 - red)));
      const L = .022, q2 = this.bhPr(p.x - p.vx * L, p.z - p.vz * L, p.b), x2 = B.x + q2[0], y2 = B.y + q2[1];
      ctx.globalAlpha = f * .85; ctx.strokeStyle = `rgb(${col.join()})`; ctx.lineWidth = p.w < 1 ? .9 : 1.3 + .6 * hot;
      ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x, y); ctx.stroke();
    }
    // the torn bubble's streams as ribbons: debris is emitted in order, so neighbours in the list are neighbours in the
    // stream — joined up (bound stream and escaping tail apart), a soft glow under a bright core
    const runs = new Map();
    for (const p of P) {
      if (!p.ev) continue;
      const q = this.bhPr(p.x, p.z, p.b), r = Math.hypot(p.x, p.z), red = Math.min(1, Math.max(0, (r - Rs) / (Rs * .9)));
      const vis = (q[2] >= 0) === near && (near || Math.hypot(q[0], q[1]) >= Rs * 1.02) && red > .05 && (p.bound || p.age < 3);
      const key = p.ev.t0 + (p.bound ? 'b' : 'u'); let R = runs.get(key); if (!R) runs.set(key, R = { col: p.col, seg: [], cur: null, last: null });
      const pt = [B.x + q[0], B.y + q[1], Math.min(1, p.age * 5) * red * (p.bound ? 1 : Math.max(0, 1 - p.age / 3))];
      if (vis && R.last && Math.hypot(pt[0] - R.last[0], pt[1] - R.last[1]) < Rs * 1.1) R.cur.push(pt);
      else if (vis) { R.cur = [pt]; R.seg.push(R.cur); }
      R.last = vis ? pt : null;
    }
    ctx.lineJoin = 'round';
    for (const R of runs.values()) for (const g of R.seg) {
      if (g.length < 3) continue;
      const a = g.reduce((s, p) => s + p[2], 0) / g.length; if (a < .03) continue;
      ctx.beginPath(); ctx.moveTo(g[0][0], g[0][1]); for (let i = 1; i < g.length; i++) ctx.lineTo(g[i][0], g[i][1]);
      ctx.globalAlpha = a * .28; ctx.strokeStyle = `rgb(${R.col})`; ctx.lineWidth = Rs * .32; ctx.stroke();
      ctx.globalAlpha = a * .9; ctx.strokeStyle = '#fff3e2'; ctx.lineWidth = 1.4; ctx.stroke();
    }
    for (const X of this.bhXs || []) {
      const q = this.bhPr(X.x, X.z, X.b); if ((q[2] >= 0) !== near) continue;
      const u = (this.time - X.t0) / .9, x = B.x + q[0], y = B.y + q[1], R = Rs * (.35 + 1.1 * u);
      ctx.globalAlpha = Math.pow(1 - u, 2) * .9; ctx.drawImage(glowSprite('#fff4e0'), x - R, y - R, R * 2, R * 2);
    }
    ctx.globalAlpha = 1;
  },
  bhUndoPlace(B) {
    const el = this.bhUndoEl; if (!el || el.style.display === 'none') return;
    const m = this.nodes.get(el.dataset.sid); if (!m || !m.eaten || m.eaten.done) { this.bhUndoHide(); return; }
    const M = this.ctx.getTransform(), d = this.dpr(), rc = this.c.getBoundingClientRect();
    const sx = rc.left + (M.a * B.x + M.c * (B.y + B.cap + 30) + M.e) / d, sy = rc.top + (M.b * B.x + M.d * (B.y + B.cap + 30) + M.f) / d;
    el.style.left = Math.max(rc.left + 110, sx) + 'px'; el.style.top = Math.min(rc.bottom - 34, sy) + 'px';
  },
  // the sessions that went in: still hidden once they're gone; back out if they never exit
  bhSweep() {
    for (const n of this.nodes.values()) {
      const E = n.eaten; if (!E || !E.done || n.dying) continue;
      if (this.time - E.gone > 30) { this.bhRelease(n); if (this.onTrash) this.onTrash(n.sid, 'stuck'); }
    }
  },
});

// the bubble being eaten is stretched along its orbit (spaghettified) and thins as its mass streams off — wraps drawMote
{
  const drawMote0 = Mesh.prototype.drawMote;
  Mesh.prototype.drawMote = function (n, dt) {
    if (!n.eaten) return drawMote0.call(this, n, dt);
    if (n.eaten.done || (n.bhScale ?? 1) < .03) return;
    const ctx = this.ctx, S = n.bhStretch || { a: 0, k: 1 }, sc = n.bhScale ?? 1;
    ctx.save();
    if (S.far && S.B) {                                              // behind the hole: the shadow hides it
      ctx.beginPath(); ctx.rect(n.x - 400, n.y - 400, 800, 800); ctx.arc(S.B.x, S.B.y, S.B.Rs, 0, 6.283); ctx.clip('evenodd');
    }
    ctx.translate(n.x, n.y); ctx.rotate(S.a); ctx.scale(S.k * sc, sc / S.k); ctx.rotate(-S.a); ctx.translate(-n.x, -n.y);
    drawMote0.call(this, n, dt); ctx.restore();
  };
}
