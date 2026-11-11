// Session bubbles as living micro-universes (after the user's reference: a magenta-rimmed red
// nebula, a cyan-rimmed violet one, a lime-rimmed fibrous green one with a glowing knot).
// Per session, three layers are rendered once — a swirled noise nebula, a sheet of radial
// fibres, and a soft glowing glass rim with light crescents. Each frame they're composited with
// counter-rotation and breathing, plus 3-D orbiting sparks; lit from the star's side (no heart-knot since 2026-10-19).
const ORB_PAL = {
  // sessions that use the 24/7 server (user's reference orb): thick magenta-violet glass, fiery red-orange
  // nebula with swirling flame fibres, a dense swarm of golden sparks and a small green-gold knot at the core
  server: { rim: '#e055dc', deep: [150, 16, 14], mid: [236, 62, 24], hot: [255, 196, 64], fib: '#ff6a2a', spark: '#ffe04a', knot: '#b6ff6a', sparks: 210, fibres: 320, rimWide: true, sparkBoost: 1.6, bigRatio: .82 },
  fable:  { rim: '#ff4fd8', deep: [120, 8, 18],  mid: [214, 36, 30],  hot: [255, 176, 46], fib: '#ff8a3a', spark: '#ffe9a6', knot: '#ffd36b' },
  mythos: { rim: '#ff4fd8', deep: [120, 8, 18],  mid: [214, 36, 30],  hot: [255, 176, 46], fib: '#ff8a3a', spark: '#ffe9a6', knot: '#ffd36b' },
  opus:   { rim: '#4fd0ff', deep: [62, 22, 128], mid: [140, 52, 205], hot: [255, 96, 176], fib: '#7a6cff', spark: '#ffffff', knot: '#ff7ad1' },
  sonnet: { rim: '#8dff5a', deep: [4, 38, 14],   mid: [22, 120, 40], hot: [150, 230, 80], fib: '#6dff7a', spark: '#e4ffb8', knot: '#fff6a0' },
  haiku:  { rim: '#ffb347', deep: [70, 24, 4],   mid: [168, 74, 12], hot: [255, 210, 110], fib: '#ffc46a', spark: '#fff1c4', knot: '#fff0a0' },
  other:  { rim: '#9fb4d8', deep: [18, 24, 48],  mid: [60, 76, 120], hot: [170, 190, 230], fib: '#a8bce8', spark: '#ffffff', knot: '#dfe8ff' },
  // a session group's main bubble (portal.js): molten gold, like the sling-ring's sparks
  portal: { rim: '#ffb347', deep: [70, 22, 6], mid: [196, 92, 20], hot: [255, 222, 140], fib: '#ffb25a', spark: '#fff0c4', knot: '#ffe08a', sparks: 120, sparkBoost: 1.3 },
  // colours the user can pick per session (session panel → Colour); c1…c5 are what main.js stores
  c1: { name: 'Aurora',  rim: '#5ef2d6', deep: [2, 30, 38],   mid: [12, 112, 118], hot: [150, 255, 222], fib: '#4fffd2', spark: '#e2fff7', knot: '#c8fff0' },
  c2: { name: 'Nebula',  rim: '#a98bff', deep: [26, 10, 66],  mid: [98, 52, 196], hot: [214, 168, 255], fib: '#b590ff', spark: '#f4ebff', knot: '#e6d6ff' },
  c3: { name: 'Solar',   rim: '#ffb547', deep: [74, 28, 4],   mid: [204, 104, 18], hot: [255, 222, 122], fib: '#ffc266', spark: '#fff4d2', knot: '#ffe8a8' },
  c4: { name: 'Rose',    rim: '#ff6fa8', deep: [84, 8, 38],   mid: [212, 52, 112], hot: [255, 176, 206], fib: '#ff8cba', spark: '#ffe6f0', knot: '#ffd0e2' },
  c5: { name: 'Glacier', rim: '#7cc8ff', deep: [6, 22, 66],   mid: [30, 92, 196], hot: [168, 224, 255], fib: '#8ccaff', spark: '#ffffff', knot: '#dff1ff' },
};
const PICK_COLORS = ['c1', 'c2', 'c3', 'c4', 'c5'];
const NOVA_T = 2.8;                                            // s, the star-birth burst when a session finishes
const orbCache = new Map();

function makeOrb(fam, seed) {
  const key = fam + ':' + Math.round(seed * 1e4); if (orbCache.has(key)) return orbCache.get(key);
  const P = ORB_PAL[fam] || ORB_PAL.other, S = 256, C = S / 2, R = S / 2 - 2;
  const mk = (w = S) => { const c = document.createElement('canvas'); c.width = c.height = w; return c; };
  const n1 = vnoise(seed * .91 + .13), n2 = vnoise(seed * .53 + .71), r = rnd(seed + .5);

  // nebula: swirled fbm, dark lanes, hot heart — like a galaxy seen inside a soap bubble
  const neb = mk(), nx = neb.getContext('2d'), img = nx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x - C) / R, dy = (y - C) / R, d = Math.hypot(dx, dy); if (d > 1) continue;
    const sw = 2.4 * (1 - d), ca = Math.cos(sw), sa = Math.sin(sw), qx = dx * ca - dy * sa, qy = dx * sa + dy * ca;   // swirl
    const a = n1(qx * 3.2 + 7, qy * 3.2 + 3, 5), b = n2(qx * 7 - 2, qy * 7 + 9, 4);
    const dens = Math.pow(Math.max(0, a * 1.35 - .3), 1.4), heart = Math.pow(Math.max(0, 1 - d / .55), 2);
    const lane = b < .42 ? (.42 - b) * 2.2 : 0;                          // dark dust lanes
    const k = Math.min(1, dens * .9 + heart * .8);
    let c = [0, 1, 2].map(i => P.deep[i] + (P.mid[i] - P.deep[i]) * Math.min(1, dens * 1.4) + (P.hot[i] - P.mid[i]) * heart * (.6 + .6 * a));
    const lum = (.55 + .7 * k) * (1 - lane * .7) * (.75 + .25 * (1 - d * d));
    const o = (y * S + x) * 4;
    img.data[o] = Math.min(255, c[0] * lum); img.data[o + 1] = Math.min(255, c[1] * lum); img.data[o + 2] = Math.min(255, c[2] * lum);
    img.data[o + 3] = 255 * (d > .96 ? (1 - d) / .04 : 1);
  }
  nx.putImageData(img, 0, 0);

  // fibres: curved radial filaments (dense for the green "creature", sparse veils for the others)
  const fib = mk(), fx = fib.getContext('2d'), nF = P.fibres || (fam === 'sonnet' ? 420 : 170);
  fx.globalCompositeOperation = 'lighter'; fx.lineCap = 'round';
  for (let i = 0; i < nF; i++) {
    const a = r() * 6.283, r0 = R * (.08 + r() * .3), r1 = R * (.55 + r() * .42), bend = (r() - .5) * .7;
    const am = a + bend, rm = (r0 + r1) / 2;
    fx.strokeStyle = hexA(r() > .85 ? mix(P.fib, .5) : P.fib, .06 + r() * (fam === 'sonnet' ? .22 : .16)); fx.lineWidth = .5 + r() * 1.3;
    fx.beginPath(); fx.moveTo(C + Math.cos(a) * r0, C + Math.sin(a) * r0);
    fx.quadraticCurveTo(C + Math.cos(am) * rm, C + Math.sin(am) * rm, C + Math.cos(a + bend * 1.6) * r1, C + Math.sin(a + bend * 1.6) * r1); fx.stroke();
  }
  // a dusting of fixed embedded stars
  for (let i = 0; i < 160; i++) {
    const a = r() * 6.283, d = Math.sqrt(r()) * R * .95, z = r();
    fx.fillStyle = hexA(z > .9 ? '#ffffff' : P.spark, .25 + .6 * z); fx.fillRect(C + Math.cos(a) * d, C + Math.sin(a) * d, z > .92 ? 2 : 1.1, z > .92 ? 2 : 1.1);
  }

  // glass rim: soft glowing band (like the mother bubble's edge) + two light crescents
  const RS = 384, RC = RS / 2, RR = RS / 2 / 1.45, rim = mk(RS), rx = rim.getContext('2d');
  const g = rx.createRadialGradient(RC, RC, RR * .6, RC, RC, RR * 1.45);   // stop k ↔ radius (.6 + .85k)·R; peak at the sphere's edge
  const rc = P.rim, rw = mix(P.rim, .55);
  if (P.rimWide) {                                       // the reference's thick, soft glass band + inner pink haze
    g.addColorStop(0, hexA(rc, 0)); g.addColorStop(.18, hexA(rc, .12)); g.addColorStop(.34, hexA(rc, .42)); g.addColorStop(.43, hexA(rw, .9));
    g.addColorStop(.5, hexA(rc, .95)); g.addColorStop(.56, hexA(rc, .6)); g.addColorStop(.68, hexA(rc, .22)); g.addColorStop(1, hexA(rc, 0));
  } else {
    g.addColorStop(0, hexA(rc, 0)); g.addColorStop(.28, hexA(rc, .14)); g.addColorStop(.42, hexA(rc, .5));
    g.addColorStop(.47, hexA(rw, .95)); g.addColorStop(.52, hexA(rc, .65)); g.addColorStop(.62, hexA(rc, .2)); g.addColorStop(1, hexA(rc, 0));
  }
  rx.fillStyle = g; rx.fillRect(0, 0, RS, RS);
  rx.filter = 'blur(4px)'; rx.lineCap = 'round';
  rx.strokeStyle = 'rgba(255,255,255,.42)'; rx.lineWidth = RR * .09;
  rx.beginPath(); rx.arc(RC, RC, RR * .84, Math.PI * 1.08, Math.PI * 1.42); rx.stroke();
  rx.strokeStyle = hexA(mix(P.rim, .7), .3); rx.lineWidth = RR * .07;
  rx.beginPath(); rx.arc(RC, RC, RR * .84, Math.PI * .12, Math.PI * .38); rx.stroke();
  rx.filter = 'none';

  // per-orb animated sparks on a sphere + the heart-knot's lobes
  const sparks = Array.from({ length: P.sparks || 70 }, () => ({ th: r() * 6.283, ph: Math.acos(2 * r() - 1), rr: .3 + r() * .65, sp: (.2 + r() * .8) * (r() > .5 ? 1 : -1), tw: r() * 6.28, big: r() > (P.bigRatio || .86) }));
  const orb = { neb, fib, rim, sparks, P, lobes: 3 + (r() * 3 | 0), RK: 1.45 };
  orbCache.set(key, orb); return orb;
}

// roots of a session bubble: its loop jobs, cron jobs, monitors, skills and sub-agents, as tendrils ending in a seed.
// Fully lit while active; fade to ~10 % after ~30 min without activity.
const ROOT_COL = { loop: '#7dd3fc', cron: '#c4b5fd', monitor: '#fcd34d', agent: '#86efac', skill: '#f9a8d4' };
const ROOT_ICON = { loop: '⟳', cron: '⏱', monitor: '◉', agent: '◆', skill: '✦' };
function rootAlpha(at) { const idle = (Date.now() - at) / 1000; return idle < 90 ? 1 : Math.max(.1, 1 - (idle - 90) / 1710 * .9); }

Object.assign(Mesh.prototype, {
  drawRoots(n, R, alive) {
    const ctx = this.ctx, t = this.time, rs = n.s.roots, k = rs.length, show = this.selected === n.sid || this.hover === n.sid;
    ctx.save();
    rs.forEach((r, i) => {
      const a0 = -Math.PI / 2 + (i - (k - 1) / 2) * Math.min(.62, 2.6 / Math.max(1, k)) + Math.sin(t * .4 + i * 1.7 + n.seed * 9) * .06;   // fanned over the top
      const L = R * 1.15 + 26 + (i % 2) * 12, a = alive * rootAlpha(r.at), col = ROOT_COL[r.kind] || '#cbd5e1';
      const x0 = n.x + Math.cos(a0) * R * .96, y0 = n.y + Math.sin(a0) * R * .96;
      const x1 = n.x + Math.cos(a0) * (R + L), y1 = n.y + Math.sin(a0) * (R + L);
      const bend = Math.sin(t * .9 + i * 2.3 + n.seed * 5) * L * .28, mx = (x0 + x1) / 2 - Math.sin(a0) * bend, my = (y0 + y1) / 2 + Math.cos(a0) * bend;
      ctx.globalAlpha = a * .55; ctx.strokeStyle = col; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke();
      const fresh = (Date.now() - r.at) < 20e3, pr = 3.2 + (fresh ? 1.4 * (1 + Math.sin(t * 6 + i)) : 0);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * .7;
      ctx.drawImage(glowSprite(col), x1 - pr * 3, y1 - pr * 3, pr * 6, pr * 6);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = a;
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x1, y1, pr, 0, 6.283); ctx.fill();
      if (show) {
        ctx.globalAlpha = Math.max(.45, a); ctx.font = '10px -apple-system, system-ui, sans-serif'; ctx.textAlign = Math.cos(a0) < -.2 ? 'right' : Math.cos(a0) > .2 ? 'left' : 'center';
        ctx.fillText(`${ROOT_ICON[r.kind] || '•'} ${String(r.label).slice(0, 34)}`, x1 + Math.cos(a0) * 8, y1 + Math.sin(a0) * 8 - 2);
      }
    });
    ctx.restore();
  },

  // size: base by lifetime spend × recency (latest-run biggest) × focus (the session you're typing in)
  // sized against the mother's core (its normal size, not your resize of it): never more than 3/4 of it (biggest spender, most frequent, focused)
  nodeRadius(n) {
    const spend = Math.min(1, Math.log10(1 + (n.s.totalUsd || 0)) / 2.8);
    const f = (.22 + .33 * spend) * (.7 + .3 * (n.rec ?? 1)) * (1 + .3 * (n.focus || 0));
    const crowd = this.lite ? Math.max(.62, Math.min(1, Math.sqrt(5 / Math.max(1, this.nodes.size)))) : 1;   // iPhone: smaller when there are many
    return Math.max(12, this.motherBase() * Math.min(.75, f) * crowd) * (1 + .3 * (n.z || 0)) * (this.sizeOf ? this.sizeOf(n.sid) : 1);   // perspective: nearer = bigger; × your size (handles.js)
  },

  drawMote(n, dt) {
    const ctx = this.ctx, s = n.s, t = this.time, fam = s.color && ORB_PAL[s.color] ? s.color : s.serverUses ? 'server' : ORB_PAL[s.family] ? s.family : 'other';
    const orb = makeOrb(fam, n.seed), P = orb.P;
    const grow = n.dying ? Math.max(0, 1 - (t - n.dying) / 2.5) : Math.min(1, (t - n.born) / 1.2);
    // opacity 50% by default, up to 100% for the most recently run session (and the focused one)
    const op = (.5 + .5 * Math.max(n.rec ?? 1, n.focus || 0)) * (.62 + .38 * (1 + (n.z || 0)) / 2), alive = grow * op * (n.moon ? 1 : Math.min(1, (n.gscale ?? 1) * 1.4));   // far side dimmer, as if deeper in space
    const work = s.health === 'working', energy = { working: 1, idle: .55, quiet: .7, waiting: .8, error: .9 }[s.health] ?? .5;
    n.phase *= Math.pow(.1, dt); n.flash *= Math.pow(.25, dt);
    // spin follows the token burn (tokens/h over the last 5 min, log scale): ~idle crawl … a fast whirl on heavy burn
    const burn = Math.min(1, Math.log10(1 + (s.tokHr || 0) / 2e5) / 2.3);
    n.burn = (n.burn ?? burn) + (burn - (n.burn ?? burn)) * Math.min(1, dt * 1.5);   // eased, so it never jumps
    if (!n.isGroup) n.spinRate = (work ? .4 : .08) + 5.5 * n.burn * n.burn;   // a group's bubble uses the sum of its members' (portal.js)
    n.spin += dt * (n.spinRate || 0) * (n.seed > .5 ? 1 : -1);
    const breathe = 1 + .025 * Math.sin(t * (work ? 3.4 : 1.3) + n.seed * 9) + .012 * Math.sin(t * 7.1 + n.seed * 3);
    const gsc = n.gscale ?? 1; if (gsc < .03) return;               // pulled through its group's portal (portal.js)
    const R = this.nodeRadius(n) * (.5 + .5 * grow) * (1 + n.swell * .1) * breathe * gsc;
    const dim = spendDim(s), shim = .78 + .22 * Math.sin(t * 2.6 + n.seed * 17) * Math.sin(t * 1.3 + n.seed * 5);
    const rimCol = s.health === 'error' ? '#ff4d6a' : P.rim;

    if (s.roots && s.roots.length && !this.off('mRoots')) this.drawRoots(n, R, alive);
    // soft outer aura
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alive * (.16 + .2 * energy + n.flash * .4) * shim * (1 - dim * .5);
    const G = R * (2.3 + n.phase * .4 + n.flash); ctx.drawImage(glowSprite(rimCol), n.x - G, n.y - G, G * 2, G * 2);
    ctx.globalCompositeOperation = 'source-over';

    // interior, clipped to the sphere
    ctx.save(); ctx.globalAlpha = alive;
    ctx.translate(n.x, n.y);
    ctx.save(); ctx.rotate(n.spin * .6); ctx.drawImage(orb.neb, -R, -R, R * 2, R * 2); ctx.restore();
    ctx.globalCompositeOperation = 'lighter';
    // the swirl turns on a tilted axis: its plane leans sideways by the bubble's own obliquity and is seen at the
    // orbit's elevation, so it reads as a spinning globe, not a flat pinwheel (follows the ring tilt too)
    // the axis also drifts a little on its own (two slow, unrelated sines per bubble: smooth, never repeating, ±~8°)
    const sd = n.seed * 97.3, wob = .09 * Math.sin(t * .23 + sd) + .05 * Math.sin(t * .137 + sd * 1.7), nod = .06 * Math.sin(t * .19 + sd * 2.3) + .03 * Math.sin(t * .31 + sd * .7);
    const obl = (n.seed - .5) * .9 + wob, kb = Math.max(.55, Math.min(1, .82 + .4 * ((this.sysTilt || 0) + nod)));
    ctx.save(); ctx.rotate(obl); ctx.scale(1, kb); ctx.rotate(-n.spin * .9 + Math.sin(t * .7 + n.seed) * .08);
    const fs = 1 + .03 * Math.sin(t * 2.2 + n.seed * 4); ctx.globalAlpha = alive * (.55 + .35 * energy) * (.85 + .15 * Math.sin(t * 3 + n.seed));
    ctx.drawImage(orb.fib, -R * fs, -R * fs, R * 2 * fs, R * 2 * fs); ctx.restore();
    // sparks orbiting on a sphere: brighter in front, twinkling
    const spd = (work ? 1 : .25) + 2 * n.burn;
    // batched: dots are bucketed by brightness and filled as one path per bucket (4 draws, not 70)
    const B = [new Path2D(), new Path2D(), new Path2D(), new Path2D()], gs = glowSprite(P.spark);
    const pit = .35 + (this.sysTilt || 0) + nod, cP = Math.cos(pit), sP = Math.sin(pit), cO = Math.cos(obl), sO = Math.sin(obl);   // the bubble's spin axis
    const lite = this.lite;                             // iPhone: every other spark, no glow sprite per spark
    for (let si = 0; si < (this.off('mSparkles') ? 0 : orb.sparks.length); si += lite ? 2 : 1) {
      const p = orb.sparks[si];
      const th = p.th + n.spin * p.sp * spd * 1.6, x0 = Math.sin(p.ph) * Math.cos(th), z0 = Math.sin(p.ph) * Math.sin(th), y0 = Math.cos(p.ph);
      const y1 = y0 * cP - z0 * sP, z = y0 * sP + z0 * cP, x = x0 * cO - y1 * sO, y = x0 * sO + y1 * cO;   // pitch toward you, then lean sideways
      const front = .35 + .65 * (z + 1) / 2, tw = .55 + .45 * Math.sin(t * (2 + p.sp * 3) + p.tw);
      const px = x * p.rr * R, py = y * p.rr * R, a = front * tw;
      if (p.big && !lite) { const g = R * .16 * front; ctx.globalAlpha = Math.min(1, alive * a * .8 * (.45 + .55 * energy) * (P.sparkBoost || 1)); ctx.drawImage(gs, px - g, py - g, g * 2, g * 2); }
      const z2 = (p.big ? 1.05 : .62) * Math.max(1, R / 40), bk = B[Math.min(3, a * 4 | 0)]; bk.moveTo(px + z2, py); bk.arc(px, py, z2, 0, 6.283);   // round, glowing dots
    }
    ctx.fillStyle = P.spark;
    B.forEach((path, i) => { ctx.globalAlpha = Math.min(1, alive * (i + .6) / 4 * (.45 + .55 * energy) * (P.sparkBoost || 1)); ctx.fill(path); });
    // 3-D shading: lit from the star's side, a soft terminator shadow on the far side
    const la = Math.atan2(this.hub.y - n.y, this.hub.x - n.x), sh = ctx.createRadialGradient(Math.cos(la) * R * .45, Math.sin(la) * R * .45, R * .15, 0, 0, R * 1.02);
    ctx.globalCompositeOperation = 'source-over';
    sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(.62, 'rgba(0,0,0,.12)'); sh.addColorStop(1, 'rgba(2,0,10,.62)');
    ctx.globalAlpha = alive; ctx.fillStyle = sh; ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.29); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    if (dim > .01) { ctx.globalAlpha = alive * dim * .75; ctx.fillStyle = '#05030f'; ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.29); ctx.fill(); }   // spend darkens it
    ctx.restore();

    // glowing glass rim (soft, like the mother bubble's edge) — shimmering
    ctx.globalCompositeOperation = 'lighter';
    const RK = R * orb.RK * (1 + .01 * Math.sin(t * 5 + n.seed));
    ctx.globalAlpha = alive * (.7 + .3 * shim) * (1 - dim * .45) * (s.health === 'error' && Math.random() > .5 ? .5 : 1);
    ctx.drawImage(orb.rim, n.x - RK, n.y - RK, RK * 2, RK * 2);
    if (n.flash > .02) { ctx.globalAlpha = n.flash; ctx.drawImage(orb.rim, n.x - RK, n.y - RK, RK * 2, RK * 2); }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    const col = sessionColor(s);

    // attention pulse
    if (s.health === 'waiting' || s.health === 'quiet') {
      const k = (t * .8) % 1; ctx.strokeStyle = `rgba(255,207,107,${(1 - k) * .7})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(n.x, n.y, R + 6 + k * 26, 0, 6.29); ctx.stroke();
    }
    // context gauge (thin outer arc)
    const ctxPct = s.ctxMax ? Math.min(1, s.ctx / s.ctxMax) : 0;
    ctx.globalAlpha = alive;
    ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(n.x, n.y, R + 14, 0, 6.29); ctx.stroke();
    ctx.strokeStyle = ctxPct > .85 ? '#ff6b7d' : ctxPct > .6 ? '#ffcf6b' : hexA(mix(P.rim, .3), .8);
    ctx.beginPath(); ctx.arc(n.x, n.y, R + 14, -Math.PI / 2, -Math.PI / 2 + ctxPct * 6.283); ctx.stroke();
    // (sub-agent satellite orbs removed at the user's request — the count stays in the session panel)
    if (this.selected === n.sid) {
      ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1; ctx.setLineDash([2, 5]);
      ctx.beginPath(); ctx.arc(n.x, n.y, R + 17, t * .6, t * .6 + 6.283); ctx.stroke(); ctx.setLineDash([]);
    }
    // label pill
    if (n.focus > .02) {                               // focused: a calm bright halo ring
      ctx.globalAlpha = grow * n.focus * (.55 + .2 * Math.sin(t * 2.4)); ctx.strokeStyle = mix(P.rim, .6); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(n.x, n.y, R + 22, 0, 6.29); ctx.stroke();
    }
    if (n.nova && t - n.nova < NOVA_T && !this.off('mNova')) this.drawNova(n, R, P, t - n.nova);
    if (gsc < .5 || n.isGroup || n.eaten || this.off('mLabels') || this.cineClean) { ctx.globalAlpha = 1; return; }      // shrinking into a portal: no tag; a group's name sits above its ring (portal.js)
    ctx.globalAlpha = grow * Math.max(.75, op) * (.85 + .15 * n.swell);
    if (this.compact || this.lite || n.gslot) {      // mini window / iPhone / inside a group's portal: one-line name tag (status = the dot)
      const nm = s.name.length > 18 ? s.name.slice(0, 17) + '…' : s.name;
      ctx.font = '600 11px -apple-system, system-ui, sans-serif, "Apple SD Gothic Neo"';
      const pw = ctx.measureText(nm).width + 18, py = n.y + R + (this.lite ? 16 : 8); n.labelW = pw;
      ctx.fillStyle = 'rgba(0,0,0,.72)'; ctx.strokeStyle = hexA(mix(P.rim, .3), .3 + .25 * n.swell); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(n.x - pw / 2, py, pw, 19, 9.5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = HEALTH_COLOR[s.health] || '#9fb4d8'; ctx.beginPath(); ctx.arc(n.x - pw / 2 + 9, py + 9.5, 2.6, 0, 6.29); ctx.fill();
      ctx.textAlign = 'center'; ctx.fillStyle = '#f2f3ff'; ctx.fillText(nm, n.x + 4, py + 13.5);
      ctx.globalAlpha = 1; return;
    }
    const name = s.name.length > 30 ? s.name.slice(0, 29) + '…' : s.name;
    const l2 = `${(s.model || '—').replace('claude-', '')}  ·  ${fmtTok(s.todayTok)}`;
    const l3 = (work ? `working · ${Math.round(s.tps)} tok/s` : s.health) + (s.owner ? '  ·  in-app' : '') + (s.serverUses ? '  ·  ⇄ server' : '');
    ctx.font = '600 12px -apple-system, system-ui, sans-serif, "Apple SD Gothic Neo"'; const w1 = ctx.measureText(name).width;
    ctx.font = '400 10.5px -apple-system, system-ui, sans-serif'; const pw = Math.max(w1, ctx.measureText(l2).width, ctx.measureText(l3).width) + 22;
    const py = n.y + R + 22, ph = 46; n.labelW = pw;
    ctx.fillStyle = 'rgba(0,0,0,.72)'; ctx.strokeStyle = hexA(mix(P.rim, .3), .3 + .25 * n.swell); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(n.x - pw / 2, py, pw, ph, 8); ctx.fill(); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = '600 12px -apple-system, system-ui, sans-serif, "Apple SD Gothic Neo"'; ctx.fillStyle = '#f2f3ff'; ctx.fillText(name, n.x, py + 15);
    ctx.font = '400 10.5px -apple-system, system-ui, sans-serif'; ctx.fillStyle = hexA(mix(col, .4), .95); ctx.fillText(l2, n.x, py + 29);
    ctx.fillStyle = HEALTH_COLOR[s.health] || '#9fb4d8'; ctx.fillText(l3, n.x, py + 41);
    ctx.globalAlpha = 1;
  },

  // star birth: when a session finishes its prompt (working → idle/waiting) the bubble flares like a new star —
  // a white-hot flash, a shockwave ring, light rays and a burst of sparks in its rim colour (~2.8 s)
  drawNova(n, R, P, e) {
    const ctx = this.ctx, k = e / NOVA_T, out = 1 - Math.pow(1 - Math.min(1, e / .9), 3), rim = P.rim, r = rnd(n.seed + Math.floor(n.nova));
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const fl = Math.max(0, 1 - e / .9);                                                     // the flash
    if (fl > 0) {
      const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, R * (1.6 + 2.6 * out));
      g.addColorStop(0, `rgba(255,255,255,${.95 * fl})`); g.addColorStop(.25, hexA(mix(rim, .6), .7 * fl)); g.addColorStop(1, hexA(rim, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(n.x, n.y, R * (1.6 + 2.6 * out), 0, 6.29); ctx.fill();
    }
    for (let i = 0; i < 2; i++) {                                                            // shockwave rings
      const q = Math.max(0, Math.min(1, (e - i * .25) / 1.6)); if (q <= 0 || q >= 1) continue;
      const qq = 1 - Math.pow(1 - q, 2.4);
      ctx.strokeStyle = hexA(i ? rim : mix(rim, .5), (1 - q) * (i ? .5 : .85)); ctx.lineWidth = (i ? 1.2 : 2.4) * (1 - q) + .4;
      ctx.beginPath(); ctx.arc(n.x, n.y, R * (1 + qq * (i ? 2.6 : 3.4)), 0, 6.29); ctx.stroke();
    }
    const ry = Math.max(0, 1 - e / 1.3);                                                     // diffraction-spike rays
    if (ry > 0) {
      const a0 = n.seed * 6.28;
      for (let i = 0; i < 8; i++) {
        const a = a0 + i * Math.PI / 4, L = R * (i % 2 ? 2.2 : 4) * (.6 + .4 * out);
        const g = ctx.createLinearGradient(n.x, n.y, n.x + Math.cos(a) * L, n.y + Math.sin(a) * L);
        g.addColorStop(0, `rgba(255,255,255,${.8 * ry})`); g.addColorStop(1, hexA(rim, 0));
        ctx.strokeStyle = g; ctx.lineWidth = i % 2 ? 1 : 1.8; ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(n.x + Math.cos(a) * L, n.y + Math.sin(a) * L); ctx.stroke();
      }
    }
    for (let i = 0; i < 70; i++) {                                                           // sparks flung out, slowing and fading
      const a = r() * 6.2832, v = .8 + r() * 2.6, d = R * (.6 + v * out * 1.7), life = Math.max(0, 1 - k * (.8 + r() * .5));
      if (life <= 0) continue;
      ctx.fillStyle = i % 3 ? hexA(mix(rim, .5), life) : `rgba(255,255,255,${life})`;
      ctx.beginPath(); ctx.arc(n.x + Math.cos(a) * d, n.y + Math.sin(a) * d, (.6 + r() * 1.4) * (.5 + .5 * life), 0, 6.29); ctx.fill();
    }
    ctx.restore();
  },
});
