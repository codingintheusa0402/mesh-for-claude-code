// Probe stories for the screen saver (2026-10-29, Kevin: "after introducing all once, a story of the probes — sun
// explosion, the trouble maker, fighting, hide and seek…, played at random"). After the first intro pass the film goes
// on with short episodes, picked at random without repeats (an intro pass comes round again every few episodes):
//   Supernova · The Trouble Maker · Hide and Seek · Probe Fight · Ring Race
// Each episode is a script over time: it takes the probes off their own routine (P.story — probe-crew launches the
// crew it needs), moves them, makes them talk (speech bubbles stay on for stories), drives the camera (story.cam) and
// draws its own effects (flare, shockwave, bolts, tethers, finish line). Bubbles it touches are only pushed or towed
// for the scene — their orbits pull them home after. Any input ends the film; the probes go back to work.
// Loaded after cine.js and probe-crew.js.

const STORY_TITLES = {
  supernova: ['Supernova', 'Every star dies. This one takes the yard with it'], thief: ['The Trouble Maker', 'Somebody always has to steal something'],
  hide: ['Hide and Seek', 'Ten… nine… eight…'], fight: ['Probe Fight', 'Two droids, one yard'], race: ['Ring Race', 'One lap. No rules.'],
};
const STORY_NEED = {};                                                         // (films: how many probes a story needs, cine-films.js)
const STORY_LEN = { supernova: 50, thief: 34, hide: 38, fight: 32, race: 30 };

Object.assign(Mesh.prototype, {
  storyPick() {
    const all = Object.keys(STORY_LEN), seen = this.storySeen || (this.storySeen = []);
    let pool = all.filter(k => !seen.includes(k)); if (!pool.length) { seen.length = 0; pool = all; }
    const k = pool[Math.random() * pool.length | 0]; seen.push(k); return k;
  },
  storyOK() { const P = this.probe; return !this.off('mProbe') && !this.compact && P && P.mode !== 'dead' && !P.held && !P.fall && !(this.probes || []).some(Q => Q.deliver); },
  storyBegin(kind) {
    const need = STORY_NEED[kind] || { supernova: 2, thief: 2, hide: 3, fight: 2, race: 3 }[kind] || 1;
    if (this.crewLaunch) this.crewLaunch(need - this.crew().length);
    const actors = this.crew().filter(P => P.mode !== 'dead' && !P.held && !P.fall).slice(0, need);
    for (const P of actors) { if (P.tidy && this.tidyStop) this.tidyStop(P); P.story = { x: P.x, y: P.y, z: 0, k: 6, max: 380 }; P.mode = 'story'; P.queue = null; P.target = null; P.scan = null; P.grav = null; }
    this.story = { kind, t: 0, actors, said: {}, fx: [], cam: { x: this.hub.x, y: this.hub.y, s: 1 }, flash: 0, held: [] };
  },
  // the end of a story — its own end, the next shot, or you coming back mid-scene: whatever it changed eases back
  // (the star's size / colour over a second, hidden things rematerialise with a glow, towed bubbles spring home on their
  // own orbits, the probes go back to their rounds) while the camera glides back to where you had it
  storyEnd() {
    const st = this.story; if (!st) return; this.story = null;
    const H = this.storyHide; this.storyHide = null;
    if (H && (H.bub || H.end || H.probe || H.star || H.starS !== 1 || H.red || H.white)) {
      const hidden = [...this.nodes.values(), ...(this.portalNodes ? this.portalNodes() : [])].filter(n => H.bub && !n._seen).map(n => n.sid);
      this.storyFade = { t0: this.time, starS: H.star ? 0 : H.starS, red: H.red, white: H.white, hidden: new Set(hidden), end: H.end, probe: H.probe };
    }
    for (const n of this.nodes.values()) n._seen = false;
    if (this.portalNodes) for (const n of this.portalNodes()) n._seen = false;
    for (const n of st.held) n.dragging = false;
    for (const P of st.actors) { P.story = null; P.scan = null; if (P.mode === 'story' || P.mode === 'land') { P.mode = 'cruise'; this.probeNext(P); } }
  },
  // a line once, at its moment
  storySay(i, at, text, health = 'working') {
    const st = this.story, P = st.actors[i]; if (!P || st.t < at || st.said[i + '@' + at]) return;
    st.said[i + '@' + at] = true; P.say = { text, health, name: this.probeName ? this.probeName(P) : 'Probe', t0: this.time, hold: this.time + Math.max(2, text.length * .055) };
  },
  storyGo(i, x, y, opt = {}) { const P = this.story.actors[i]; if (P && P.story) Object.assign(P.story, { x, y, k: 6, max: 380, z: 0, direct: false, scanOn: null, spin: 0, face: null }, opt); },   // (spin / face last only as long as a beat keeps asking: 2026-11-01, a spun probe used to spin forever)
  storyStep(dt) {
    const st = this.story; if (!st) return;
    st.t += dt; st.flash = Math.max(0, st.flash - dt * 1.4);
    const fn = this['story_' + st.kind]; if (fn) fn.call(this, st, st.t, dt);
    st.fx = st.fx.filter(f => st.t - f.t0 < (f.life || 1));
  },
  // the actors fly where the script puts them
  storyActorStep(P, dt, base) {
    const A = P.story, t = this.time, seed = P.seed ?? (P.seed = Math.random() * 100);
    // each probe its own life: a slow hover wander round its mark (so two probes sent to marks side by side don't sit
    // there like parked cars) — not when the script drives it exactly
    const wx = A.direct ? 0 : Math.sin(t * .47 + seed * 7.1) * 16 + Math.sin(t * 1.13 + seed) * 5, wy = A.direct ? 0 : Math.cos(t * .39 + seed * 3.7) * 11 + Math.sin(t * .91 + seed * 2) * 4;
    if (A.direct) { const nx = A.x, ny = A.y; P.vx = (nx - P.x) / Math.max(dt, 1e-3); P.vy = (ny - P.y) / Math.max(dt, 1e-3); P.x = nx; P.y = ny; }
    else {
      const k = A.k, ax = (A.x + wx - P.x) * k - P.vx * 2 * Math.sqrt(k) * .85, ay = (A.y + wy - P.y) * k - P.vy * 2 * Math.sqrt(k) * .85;
      P.vx += ax * dt; P.vy += ay * dt; const sp = Math.hypot(P.vx, P.vy); if (sp > A.max) { P.vx *= A.max / sp; P.vy *= A.max / sp; }
      P.x += P.vx * dt; P.y += P.vy * dt;
    }
    // a spin (hit, knocked out) runs down smoothly once the beat stops asking for it, then the probe recovers
    P.spinV = A.spin ? A.spin : (P.spinV || 0) * Math.pow(.15, dt);
    if (Math.abs(P.spinV) > .3) P.yaw += P.spinV * dt;
    else { const sp = Math.hypot(P.vx, P.vy), idle = seed + Math.sin(t * .23 + seed * 5) * 1.1;   // at rest: each looks its own way, slowly
      const want = A.face != null ? A.face + Math.sin(t * .3 + seed) * .25 : sp > 40 ? Math.atan2(P.vx, P.vy) : idle; let d = want - P.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); P.yaw += d * Math.min(1, dt * (sp > 40 ? 5 : 1.6)); }
    const sp = Math.hypot(P.vx, P.vy), hd = Math.atan2(P.vy, P.vx); let w = 0; if (sp > 25 && P.hd != null) { w = hd - P.hd; w = Math.atan2(Math.sin(w), Math.cos(w)) / Math.max(dt, 1e-3); }
    P.hd = sp > 25 ? hd : P.hd; P.bank = (P.bank || 0) + (Math.max(-.6, Math.min(.6, w * .2)) - (P.bank || 0)) * Math.min(1, dt * 5);
    P.z += ((A.z || 0) - P.z) * Math.min(1, dt * 3); P.gs = 1;
    if (A.scanOn && P.mode !== 'land') { P.scanT0 = t; P.bm = []; }                              // (the beam grows from when the scan starts)
    P.mode = A.scanOn ? 'land' : 'story'; P.scan = A.scanOn || null; if (A.scanOn) P.until = t + 5;
    if (P.say && !P.say.out && !(P.say.hold > t)) P.say.out = t;
    if (P.say && P.say.out && t - P.say.out > .45) P.say = null;
    P.S = base * (1 + .35 * P.z); P.dx = P.x; P.dy = P.y + Math.sin(t * 2.4 + (P.crew || 0)) * 2; P.sp = sp;
    return true;
  },
  storyNodes() { return [...this.nodes.values()].filter(n => !n.dying && !n.eaten && !n.gslot && n.s && !n.s.group); },

  // ---------------- 1. Supernova ----------------
  // (Kevin 2026-10-29: the star turns colour, explodes and takes every bubble, the Endurance and the probes with it; the
  // black hole slowly swallows the remains; a new star is born.) Screen saver only, and only on screen: nothing real
  // is touched — the scene hides things (this.storyHide) and brings them all back at the end.
  story_supernova(st, t, dt) {
    const h = this.hub, MR = this.motherRadius(), B = this.bhGeom ? this.bhGeom() : { x: h.x - 600, y: h.y + 200, Rs: 30 }, d = this.endDock ? this.endDock() : { x: h.x + 500, y: h.y - 200 };
    const H = st.hide || (st.hide = { bub: false, end: false, probe: false, star: false, starS: 1, red: 0, white: 0, reveal: null });
    this.storyHide = H;
    const ease = u => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
    // 0–15: the star swells and reddens; the probes back off
    if (t < 15) {
      H.red = ease((t - 2) / 11); H.starS = 1 + .55 * ease((t - 2) / 11);
      const back = 1.8 + 1.4 * ease((t - 4) / 9);
      this.storyGo(0, h.x - MR * back, h.y + MR * .4, { k: 2 }); this.storyGo(1, h.x + MR * back, h.y + MR * .3, { k: 2 });
      st.cam = { x: h.x, y: h.y, s: 1.25 - .5 * ease((t - 3) / 11) };
      this.storySay(0, 1, 'Is the sun turning… red?'); this.storySay(1, 4, 'Red giant. That\'s the old-age phase, right?'); this.storySay(0, 8.5, 'It\'s getting fucking huge.', 'error'); this.storySay(1, 12, 'We should back the fuck up.', 'error');
    }
    // 15–17.5: the core collapses, white-hot
    if (t >= 15 && t < 17.5) { const u = ease((t - 15) / 2.5); H.starS = 1.55 - .95 * u; H.white = u; H.red = 1 - u; st.cam = { x: h.x + Math.sin(t * 70) * 3 * u, y: h.y, s: .75 + .25 * u }; this.storySay(0, 15.3, 'Oh fuck.', 'error'); this.storySay(1, 15.6, 'Oh FUCK.', 'error'); }
    // 17.5: it goes — a flash, shockwaves, everything turns to debris
    if (t >= 17.5 && !st.boom) {
      st.boom = true; st.flash = 1.6; H.star = H.bub = H.end = H.probe = true; H.white = 0; H.red = 0;
      st.fx.push({ k: 'wave', t0: t, life: 3.2 }, { k: 'wave', t0: t + .3, life: 3.4 }, { k: 'wave', t0: t + .7, life: 3.6 });
      const P = st.parts = [], add = (x, y, n, cols, sp, sz) => { for (let i = 0; i < n; i++) { const a = Math.random() * 6.2832, v = sp * (.3 + Math.random()); P.push({ x, y, vx: Math.cos(a) * v + (x - h.x) * .6, vy: Math.sin(a) * v + (y - h.y) * .6, c: cols[i % cols.length], s: sz * (.5 + Math.random()), in: false }); } };
      add(h.x, h.y, this.lite ? 160 : 360, ['#fff1c8', '#ffb35a', '#ff6a2a', '#ffd88a'], 520, 9);
      for (const n of this.storyNodes()) add(n.x, n.y, 18, ['#a98bff', '#5ac8ff', '#ff7ab8'], 260, 7);
      for (const Q of [...this.portalNodes ? this.portalNodes() : []]) add(Q.x, Q.y, 24, ['#ffba5c', '#ff7a2a'], 260, 8);
      add(d.x, d.y, 40, ['#cfd6e2', '#8e98a8'], 300, 7);
      for (const Q of st.actors) add(Q.x, Q.y, 14, ['#7fe8ff', '#ffd65a'], 360, 6);
    }
    // 17.5–34: the remains drift, then the black hole drags them in and swallows them
    if (st.parts) {
      const pull = ease((t - 21) / 6) * 260000, live = st.parts.filter(p => !p.in);
      for (const p of live) {
        const dx = B.x - p.x, dy = B.y - p.y, r2 = dx * dx + dy * dy, r = Math.sqrt(r2) || 1;
        if (t < 31) { p.vx += (dx / r * pull / Math.max(r2, 900) - p.vy * .0) * dt * 60 * .016; p.vy += (dy / r * pull / Math.max(r2, 900)) * dt * 60 * .016; p.vx += -dy / r * pull / Math.max(r2, 900) * .5 * dt; p.vy += dx / r * pull / Math.max(r2, 900) * .5 * dt; }
        const damp = Math.pow(t < 21 ? .55 : .85, dt); p.vx *= damp; p.vy *= damp; p.x += p.vx * dt; p.y += p.vy * dt;
        if (r < (B.Rs || 30) * 1.1) { p.in = true; st.bhGlow = Math.min(1.5, (st.bhGlow || 0) + .02); }
      }
      st.bhGlow = Math.max(0, (st.bhGlow || 0) - dt * .4);
      // 31+: what's left near the old star falls back together — a nebula collapsing into a protostar
      if (t >= 31) for (const p of live) { const dx = h.x - p.x, dy = h.y - p.y; p.vx += dx * dt * 1.8; p.vy += dy * dt * 1.8; if (Math.hypot(dx, dy) < 12) p.in = true; }
      st.cam = t < 31 ? { x: (h.x + B.x) / 2, y: (h.y + B.y) / 2, s: .6 } : { x: h.x, y: h.y, s: .6 + .5 * ease((t - 31) / 6) };
      st.nebula = t < 31 ? Math.min(1, (t - 17.5) / 3) : Math.max(0, 1 - (t - 31) / 6);
    }
    // 37–41: a new star is born
    if (t >= 37) { H.star = false; H.starS = ease((t - 37) / 3.5) * 1; H.white = Math.max(0, 1 - (t - 37) / 4); if (!st.born) { st.born = true; st.fx.push({ k: 'birth', t0: t, life: 2.5 }); st.flash = .5; } }
    // 41–48: the yard comes back — bubbles pop in one by one, the Endurance, the probes launched from it
    if (t >= 41) {
      H.end = false;
      const L = this.storyNodes().concat(this.portalNodes ? this.portalNodes() : []);
      if (!H.reveal) { H.reveal = new Map(); L.forEach((n, i) => H.reveal.set(n.sid, 41.5 + i * .35)); }
      for (const n of L) { const at = H.reveal.get(n.sid) ?? 41; if (t >= at && !n._seen) { n._seen = true; st.fx.push({ k: 'pop', t0: t, x: n.x, y: n.y, R: this.nodeRadius(n), life: .7 }); } }
      if (t >= 43) { H.probe = false; if (!st.relaunch) { st.relaunch = true; for (const Q of st.actors) { Q.x = d.x; Q.y = d.y; Q.vx = (Math.random() - .5) * 300; Q.vy = -260; } } this.storyGo(0, h.x - MR * 2, h.y + MR * 1.2, { k: 2 }); this.storyGo(1, h.x + MR * 2, h.y + MR * 1.2, { k: 2 }); }
      st.cam = { x: h.x, y: h.y, s: 1 };
      this.storySay(0, 44.5, 'Did… did we just die?'); this.storySay(1, 46.5, 'New star, new paint. Same shitty job.');
    }
    if (t >= 48) { H.bub = false; }
  },
  // ---------------- 2. The Trouble Maker ----------------
  story_thief(st, t, dt) {
    const h = this.hub, B = this.bhGeom ? this.bhGeom() : { x: h.x - 600, y: h.y + 200, Rs: 30 };
    if (!st.victim) { const L = this.storyNodes().sort((a, b) => Math.hypot(b.x - B.x, b.y - B.y) - Math.hypot(a.x - B.x, a.y - B.y)); st.victim = L[Math.min(1, L.length - 1)]; if (!st.victim) return; }
    const V = st.victim, R = this.nodeRadius(V), T = st.actors[1], L0 = st.actors[0]; if (!T || !L0) return;
    if (t < 4) { this.storyGo(1, V.x, V.y - R - 60, { k: 2.5, max: 140 }); this.storyGo(0, h.x + 420, h.y - 160, { k: 2 }); st.cam = { x: V.x, y: V.y, s: 1.5 }; }
    this.storySay(1, .6, 'Nobody\'s looking… perfect.'); this.storySay(0, 1.5, 'La la la, patrolling. Nothing ever happens here.');
    if (t >= 4 && t < 13.5) {                                                    // grabbed and dragged toward the black hole
      if (!V.dragging) { V.dragging = true; st.held.push(V); st.fx.push({ k: 'grab', t0: t, life: 1 }); }
      const u = Math.min(1, (t - 4) / 9), tx = V.x + (B.x - V.x) * .03, ty = V.y + (B.y - V.y) * .03;
      this.storyGo(1, tx + (B.x - tx) * u * .9, ty - R - 60 + (B.y - ty) * u * .9, { k: 3, max: 180 });
      V.x += ((T.x) - V.x) * Math.min(1, dt * 3); V.y += ((T.y + R + 60) - V.y) * Math.min(1, dt * 3); V.vx = V.vy = 0;
      st.tether = [T, V];
      if (t >= 6) this.storyGo(0, T.x + 40, T.y - 20, { k: 3, max: 420 });
      st.cam = { x: (T.x + L0.x) / 2, y: (T.y + L0.y) / 2 + 40, s: 1.05 };
      this.storySay(1, 4.4, 'Into the hole with you, ha!'); this.storySay(0, 6, 'HEY! Put that down, asshole!', 'error'); this.storySay(1, 9, 'Can\'t catch me, narc!'); this.storySay(0, 11.5, 'Drop it or I swear to God!', 'error');
    }
    if (t >= 13.5 && !st.bust) { st.bust = true; st.fx.push({ k: 'zap', t0: t, x: T.x, y: T.y, life: .8 }); T.vx = 700; T.vy = -500; T.story.spin = 12; T.story.max = 700; st.flash = .35; }
    if (t >= 13.5 && t < 23) {                                                    // the lead tows it back home
      T.story.spin = t < 15 ? 12 : 0; this.storyGo(1, h.x + 700, h.y - 360, { k: 1.2, max: 260, spin: t < 15 ? 12 : 0 });
      const o = this.loadOrbits()[V.sid], home = o ? this.orbitPos(o) : { x: h.x + 300, y: h.y };
      this.storyGo(0, home.x, home.y - R - 60, { k: 1.4, max: 160 });
      V.x += (L0.x - V.x) * Math.min(1, dt * 3); V.y += ((L0.y + R + 60) - V.y) * Math.min(1, dt * 3); V.vx = V.vy = 0;
      st.tether = [L0, V]; st.cam = { x: V.x, y: V.y, s: 1.3 };
      this.storySay(1, 14, 'OW! Snitch!', 'error'); this.storySay(0, 15.5, 'Back in your bunk, kid. You\'re safe.'); this.storySay(0, 20, 'Nobody steals on my watch.');
    }
    if (t >= 23 && st.tether) { st.tether = null; V.dragging = false; st.held = []; }
    if (t >= 23) { this.storyGo(1, L0.x + 90, L0.y + 20, { k: 1.5, max: 200 }); st.cam = { x: L0.x, y: L0.y, s: 1.4 }; this.storySay(1, 24.5, 'Fine. I was just borrowing it.'); this.storySay(0, 27.5, 'Borrowing my ass. Back to work, both of us.'); }
  },
  // ---------------- 3. Hide and Seek ----------------
  story_hide(st, t, dt) {
    const h = this.hub, MR = this.motherRadius();
    if (!st.spot) { const L = this.storyNodes().filter(n => (n.z || 0) > .2).sort((a, b) => Math.hypot(b.x - h.x, b.y - h.y) - Math.hypot(a.x - h.x, a.y - h.y)); const A = this.storyNodes(); st.spot = L[0] || A[0]; st.decoy = A.find(n => n !== st.spot) || st.spot; if (!st.spot) return; }
    const S = st.spot, D = st.decoy;
    if (t < 3) { this.storyGo(0, h.x, h.y + MR * 1.5); this.storyGo(1, h.x - 70, h.y + MR * 1.6); this.storyGo(2, h.x + 70, h.y + MR * 1.6); st.cam = { x: h.x, y: h.y + MR, s: 1.4 }; }
    this.storySay(0, .5, 'Hide and seek. I\'m counting. Ten… nine… eight…'); this.storySay(2, 1.8, 'Don\'t peek, asshole.');
    if (t >= 3 && t < 9) {                                                        // the seeker faces the star; the others hide
      this.storyGo(0, h.x, h.y + MR * 1.35, { face: Math.PI }); this.storyGo(1, h.x + MR * .2, h.y - MR * .2, { z: -1, k: 3 }); this.storyGo(2, S.x + 4, S.y - 4, { z: -.9, k: 3 });
      st.cam = { x: h.x, y: h.y + MR * .6, s: 1.05 };
      this.storySay(0, 5, 'Three… two… one…');
    }
    this.storySay(0, 9, 'Ready or not, here I come, motherfuckers!');
    if (t >= 9 && t < 15) { this.storyGo(0, D.x, D.y - this.nodeRadius(D) - 40, { k: 3, scanOn: t > 11.5 ? { x: D.x, y: D.y, R: this.nodeRadius(D) } : null }); this.storyGo(1, h.x + MR * .2, h.y - MR * .2, { z: -1 }); this.storyGo(2, S.x + 4, S.y - 4, { z: -.9 }); st.cam = { x: D.x, y: D.y, s: 1.4 }; this.storySay(0, 13.5, 'Not here. Hmm.'); }
    if (t >= 15 && t < 23) {
      this.storyGo(0, S.x, S.y - this.nodeRadius(S) - 40, { k: 3, scanOn: t > 17.5 ? { x: S.x, y: S.y, R: this.nodeRadius(S) } : null });
      if (t < 19.5) this.storyGo(2, S.x + 4, S.y - 4, { z: -.9 }); else this.storyGo(2, h.x - MR * 1.4, h.y + MR * 1.3, { k: 4, max: 520 });
      this.storyGo(1, h.x + MR * .2, h.y - MR * .2, { z: -1 }); st.cam = { x: S.x, y: S.y, s: 1.35 };
      this.storySay(0, 19.2, 'FOUND YOU!'); this.storySay(2, 19.8, 'Shit! Cheater! You used the scanner!', 'error');
    }
    if (t >= 23 && t < 30) {
      this.storyGo(0, h.x, h.y - MR * 1.5, { k: 2.5 }); this.storyGo(1, h.x + MR * .2, h.y - MR * .2, { z: t > 26 ? 0 : -1 }); this.storyGo(2, h.x - MR * 1.4, h.y + MR * 1.3);
      if (t > 26) this.storyGo(1, h.x + MR * 1.4, h.y - MR * 1.2, { k: 4 });
      st.cam = { x: h.x, y: h.y, s: 1.05 };
      this.storySay(0, 24.5, 'I see your thruster glow behind the sun, dumbass.'); this.storySay(1, 26.3, 'Damn it! It was the perfect spot!', 'error');
    }
    if (t >= 30) { this.storyGo(0, h.x, h.y + MR * 1.5); this.storyGo(1, h.x - 80, h.y + MR * 1.6); this.storyGo(2, h.x + 80, h.y + MR * 1.6); st.cam = { x: h.x, y: h.y + MR, s: 1.3 }; this.storySay(2, 31, 'Again! I\'m seeking this time.'); this.storySay(0, 33.5, 'After work. Move it, crew.'); }
  },
  // ---------------- 4. Probe Fight ----------------
  story_fight(st, t, dt) {
    const h = this.hub, MR = this.motherRadius(), cx = h.x, cy = h.y + MR * 2.2, A = st.actors[0], B = st.actors[1]; if (!A || !B) return;
    if (t < 3.5) { this.storyGo(0, cx - 230, cy, { face: Math.PI / 2 }); this.storyGo(1, cx + 230, cy, { face: -Math.PI / 2 }); st.cam = { x: cx, y: cy, s: 1.25 }; }
    this.storySay(0, .6, 'You looking at me?'); this.storySay(1, 2, 'Yeah, I\'m looking at you, asshole.');
    if (t >= 3.5 && t < 20) {                                                     // circling, shooting
      const a = (t - 3.5) * 1.1, r = 210 + 40 * Math.sin(t * 1.7);
      this.storyGo(0, cx + Math.cos(a) * r, cy + Math.sin(a) * r * .5, { k: 8, max: 600 }); this.storyGo(1, cx - Math.cos(a) * r, cy - Math.sin(a) * r * .5, { k: 8, max: 600 });
      if (t - (st.lastShot || 0) > .55) { st.lastShot = t; st.shot = (st.shot || 0) + 1; const [S, D] = st.shot % 2 ? [A, B] : [B, A]; st.fx.push({ k: 'bolt', t0: t, from: S, to: D, col: S === A ? '#ff5a4a' : '#5ac8ff', life: .45 }); }
      st.cam = { x: cx, y: cy, s: 1.05 };
      this.storySay(0, 5, 'Pew pew, motherfucker!'); this.storySay(1, 8, 'You shoot like a guard, buddy!'); this.storySay(0, 12, 'Hold still, damn it!'); this.storySay(1, 16, 'Eat this!');
    }
    if (t >= 20 && !st.ko) { st.ko = true; st.fx.push({ k: 'bolt', t0: t, from: B, to: A, col: '#ffffff', life: .6, big: 1 }); st.flash = .5; A.vx = (h.x - A.x) * 2.2; A.vy = (h.y - A.y) * 2.2; A.story.spin = 14; A.story.max = 900; }
    if (t >= 20 && t < 26) {
      this.storyGo(0, h.x + (A.x - h.x) * .2, h.y + MR * 1.25, { k: t < 22 ? .4 : 3, max: 900, spin: t < 22 ? 14 : 0 }); this.storyGo(1, cx + 120, cy - 40, { k: 2 });
      st.cam = { x: (A.x + h.x) / 2, y: (A.y + h.y) / 2 + 40, s: 1.05 };
      this.storySay(0, 20.4, 'AAAH! The star! THE STAR!', 'error'); this.storySay(1, 22.5, 'Shit! You okay?!', 'error'); this.storySay(0, 24, 'Not today, sun! Not today!');
    }
    if (t >= 26) {
      this.storyGo(0, cx - 40, cy - 20, { k: 2 }); this.storyGo(1, cx + 40, cy - 20, { k: 2 }); st.cam = { x: cx, y: cy - 20, s: 1.45 };
      this.storySay(1, 26.5, 'Truce? Drinks are on me.'); this.storySay(0, 29, 'Truce. You still shoot like a guard.');
    }
  },
  // ---------------- 5. Ring Race ----------------
  story_race(st, t, dt) {
    const h = this.hub, sh = this.orbitShape(), rx = sh.rx * 1.08, k = sh.k, a0 = Math.PI / 2 - (this.sysRot || 0) * 0;
    const lane = i => rx + (i - 1) * 34, pos = (i, a) => ({ x: h.x + Math.cos(a) * lane(i), y: h.y + Math.sin(a) * lane(i) * k, z: Math.sin(a) });
    if (!st.r) st.r = st.actors.map((_, i) => ({ a: a0, v: 0, top: 1.05 + Math.random() * .35, burst: 4 + Math.random() * 8 }));
    if (t < 5) { st.actors.forEach((P, i) => { const p = pos(i, a0); this.storyGo(i, p.x, p.y, { k: 6 }); }); st.cam = { x: h.x, y: h.y + rx * k, s: 1.35 }; }
    this.storySay(0, .5, 'One lap. No rules. Loser cleans the Endurance.'); this.storySay(1, 2, 'Three…'); this.storySay(2, 3, 'Two…'); this.storySay(0, 4, 'One… GO, motherfuckers!');
    if (t >= 5 && !st.done) {
      st.actors.forEach((P, i) => {
        const R = st.r[i], race = t - 5, boost = race > R.burst && race < R.burst + 2 ? 1.5 : 1, lead = Math.max(...st.r.map(x => x.a)), catchup = 1 + (lead - R.a) * .6;
        R.v += ((R.top * boost * catchup * .42) - R.v) * Math.min(1, dt * 1.5); R.a += R.v * dt;
        const p = pos(i, R.a); this.storyGo(i, p.x, p.y, { direct: true, z: p.z });
        if (R.a >= a0 + Math.PI * 2 && !R.fin) { R.fin = t; st.fx.push({ k: 'finish', t0: t, x: p.x, y: p.y, life: 1.2 }); }
      });
      const lead = st.actors.reduce((b, P, i) => st.r[i].a > st.r[b].a ? i : b, 0), lp = pos(lead, st.r[lead].a);
      st.cam = { x: (lp.x + h.x) / 2, y: (lp.y + h.y) / 2, s: .85 };
      if (st.r.every(R => R.fin)) { st.done = t; st.order = st.r.map((R, i) => [R.fin, i]).sort((a, b) => a[0] - b[0]).map(x => x[1]); }
      this.storySay(1, 11, 'Eat my exhaust!'); this.storySay(2, 15, 'Outta my lane, asshole!'); this.storySay(0, 18, 'Turbo, baby!');
    }
    if (st.done) {
      const [w, , l] = st.order, p = pos(0, a0);
      st.actors.forEach((P, i) => this.storyGo(i, p.x + (i - 1) * 60, p.y - 40, { k: 2.5 }));
      st.cam = { x: p.x, y: p.y, s: 1.35 };
      if (!st.said.win) { st.said.win = true; const W = st.actors[w], L = st.actors[l]; if (W) W.say = { text: pick2(['Winner winner! Clean that Endurance, loser.', 'Too easy. Who\'s next?', 'And THAT is how a con drives.']), health: 'working', name: this.probeName ? this.probeName(W) : 'Probe', t0: this.time, hold: this.time + 3 }; if (L && L !== W) setTimeout(() => { if (this.story === st) L.say = { text: pick2(['Rigged! This race was fucking rigged!', 'My thruster was cold, asshole.', 'Rematch. Right now.']), health: 'error', name: this.probeName ? this.probeName(L) : 'Probe', t0: this.time, hold: this.time + 3 }; }, 2200); }
    }
  },

  // ---------------- the effects (world space) ----------------
  drawStory(ctx) {
    const st = this.story; if (!st) return;
    const t = st.t, h = this.hub, MR = this.motherRadius();
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    if (st.nebula > 0) { const R = MR * (2.5 + 3 * Math.min(1, (t - 17.5) / 10)) * (st.nebula < 1 && t > 31 ? .4 + .6 * st.nebula : 1); ctx.globalAlpha = .35 * st.nebula; ctx.drawImage(glowSprite('#b06aff'), h.x - R, h.y - R, R * 2, R * 2); ctx.globalAlpha = .3 * st.nebula; ctx.drawImage(glowSprite('#ff8a3a'), h.x - R * .7, h.y - R * .7, R * 1.4, R * 1.4); }
    if (st.parts) for (const p of st.parts) { if (p.in) continue; ctx.globalAlpha = .85; ctx.drawImage(glowSprite(p.c), p.x - p.s, p.y - p.s, p.s * 2, p.s * 2); }
    if (st.bhGlow > 0 && this.bhGeom) { const B = this.bhGeom(), R = (B.Rs || 30) * (3 + st.bhGlow * 2); ctx.globalAlpha = Math.min(1, st.bhGlow) * .7; ctx.drawImage(glowSprite('#ffcf8a'), B.x - R, B.y - R, R * 2, R * 2); }
    if (st.charge > 0) { const R = MR * (1.6 + st.charge * 1.4 + .1 * Math.sin(this.time * 30)); ctx.globalAlpha = Math.min(1, st.charge) * .85; ctx.drawImage(glowSprite('#ffd9a0'), h.x - R, h.y - R, R * 2, R * 2); }
    if (st.tether) { const [P, V] = st.tether; ctx.strokeStyle = 'rgba(160,240,255,.8)'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]); ctx.lineDashOffset = -this.time * 40; ctx.beginPath(); ctx.moveTo(P.dx, P.dy + P.S * .4); ctx.lineTo(V.x, V.y - this.nodeRadius(V)); ctx.stroke(); ctx.setLineDash([]); }
    for (const f of st.fx) {
      const u = (t - f.t0) / (f.life || 1); if (u < 0) continue;
      if (f.k === 'wave') { const R = MR + u * Math.max(this.w, this.h) * 1.3; ctx.globalAlpha = Math.pow(1 - u, 1.5); ctx.strokeStyle = '#ffe2b0'; ctx.lineWidth = 18 * (1 - u) + 2; ctx.beginPath(); ctx.arc(h.x, h.y, R, 0, 6.2832); ctx.stroke(); }
      else if (f.k === 'bolt' && f.from && f.to) {
        const x0 = f.from.dx, y0 = f.from.dy, x1 = f.to.dx, y1 = f.to.dy, a = Math.min(1, u * 2.2), b = Math.max(0, u * 2.2 - .5);
        ctx.globalAlpha = 1 - u * .5; ctx.strokeStyle = f.col; ctx.lineWidth = f.big ? 6 : 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x0 + (x1 - x0) * b, y0 + (y1 - y0) * b); ctx.lineTo(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a); ctx.stroke();
        if (a >= 1) { const r = (f.big ? 60 : 26) * (1 - u); ctx.drawImage(glowSprite(f.col), x1 - r, y1 - r, r * 2, r * 2); }
      }
      else if (f.k === 'birth') { const R = MR * (1 + u * 4); ctx.globalAlpha = Math.pow(1 - u, 1.4); ctx.strokeStyle = '#d8f0ff'; ctx.lineWidth = 6 * (1 - u) + 1; ctx.beginPath(); ctx.arc(h.x, h.y, R, 0, 6.2832); ctx.stroke(); ctx.globalAlpha = (1 - u) * .8; ctx.drawImage(glowSprite('#ffffff'), h.x - MR * 2.2, h.y - MR * 2.2, MR * 4.4, MR * 4.4); }
      else if (f.k === 'pop') { const R = f.R * (1 + u * 1.2); ctx.globalAlpha = 1 - u; ctx.strokeStyle = '#e6f2ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(f.x, f.y, R, 0, 6.2832); ctx.stroke(); ctx.globalAlpha = (1 - u) * .6; ctx.drawImage(glowSprite('#cfe6ff'), f.x - R, f.y - R, R * 2, R * 2); }
      else if (f.k === 'zap' || f.k === 'finish') { const r = (f.k === 'zap' ? 90 : 120) * (.4 + u); ctx.globalAlpha = 1 - u; ctx.strokeStyle = f.k === 'zap' ? '#ffffff' : '#ffd65a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, 6.2832); ctx.stroke(); ctx.drawImage(glowSprite(f.k === 'zap' ? '#ffffff' : '#ffd65a'), f.x - r * .7, f.y - r * .7, r * 1.4, r * 1.4); }
    }
    ctx.restore();
  },
});

{
  const M = Mesh.prototype;
  // the actors: scripted while a story has them (outermost of the probe-life hooks)
  const life0 = M.probeLife;
  M.probeLife = function (P, dt, base) { if (P.story && this.story && !P.held && !P.fall && P.mode !== 'dead') return this.storyActorStep(P, dt, base); if (P.story && !this.story) P.story = null; return life0.call(this, P, dt, base); };
  // effects drawn under the probes (and the probes hidden while the supernova has them)
  const draw0 = M.drawProbe;
  M.drawProbe = function (ctx, dt, layer) {
    if (!this.story) return draw0.call(this, ctx, dt, layer);
    try {                                                                         // (a scene that trips ends itself — the mesh never freezes)
      if (layer === 'front') this.drawStory(ctx);
      const H = this.storyHide; if (H && H.probe) { if (layer === 'back' && this.crewEach) this.crewEach(P => this.probeLife(P, dt, 30)); return; }
      return draw0.call(this, ctx, dt, layer);
    } catch (e) { console.warn('[story] stopped:', e && e.message); ctx.restore && ctx.setTransform && 0; this.storyEnd(); }
  };
  const sayH = M.drawProbeSay;
  M.drawProbeSay = function (ctx) { const H = this.storyHide; if (H && H.probe) { for (const E of [this.sayEl, ...(this.probes || []).map(P => P._sayEl)]) if (E) E.style.display = 'none'; return; } return sayH.call(this, ctx); };
  // the supernova's hiding: bubbles (each comes back at its reveal), portals, links, the Endurance; the star scaled and
  // tinted (red giant → white-hot) or gone
  const mote0 = M.drawMote;
  M.drawMote = function (n, dt) {
    const H = this.storyHide; if (H && H.bub && !n._seen) return;
    const r = mote0.call(this, n, dt), F = this.storyFade;
    if (F && F.hidden.has(n.sid)) {                                              // rematerialising: a white glow that fades off it
      const u = Math.min(1, (this.time - F.t0) / .9), ctx = this.ctx, R = this.nodeRadius(n) * (n.gscale ?? 1) * 1.6;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - u) * .9; ctx.drawImage(glowSprite('#eaf4ff'), n.x - R, n.y - R, R * 2, R * 2); ctx.restore();
    }
    return r;
  };
  const portals0 = M.drawPortals;
  M.drawPortals = function (ctx, layer, dt) { const H = this.storyHide; if (H && H.bub && !(this.portalNodes && this.portalNodes().some(n => n._seen))) return; return portals0.call(this, ctx, layer, dt); };
  const ring0 = M.drawOrbitRing, orbs0 = M.drawSessionOrbits;
  M.drawOrbitRing = function (ctx, near) { const H = this.storyHide; if (H && H.bub) return; return ring0.call(this, ctx, near); };
  M.drawSessionOrbits = function (ctx, near) { const H = this.storyHide; if (H && H.bub) return; return orbs0.call(this, ctx, near); };
  const links0 = M.drawLinks;
  M.drawLinks = function (ctx) { const H = this.storyHide; if (H && (H.bub || H.star)) return; return links0.call(this, ctx); };
  const end0d = M.drawEndurance;
  M.drawEndurance = function (ctx, pass) { const H = this.storyHide; if (H && H.end) return; return end0d.call(this, ctx, pass); };
  const att0 = M.drawAttractor;
  M.drawAttractor = function (dt) {
    let H = this.storyHide;
    const F = this.storyFade;
    if (!H && F) {                                                               // easing back to the real star
      const u = Math.min(1, (this.time - F.t0) / .9), e = 1 - Math.pow(1 - u, 3);
      if (u >= 1) this.storyFade = null;
      else H = { starS: F.starS + (1 - F.starS) * e, red: F.red * (1 - e), white: F.white * (1 - e) + (F.starS < .5 ? .6 * (1 - e) : 0) };
    }
    if (!H) return att0.call(this, dt);
    if (H.star || H.starS <= .01) return;
    const ctx = this.ctx, h = this.hub; ctx.save(); ctx.translate(h.x, h.y); ctx.scale(H.starS, H.starS); ctx.translate(-h.x, -h.y);
    const f = []; if (H.red > 0) f.push(`sepia(${(H.red * .8).toFixed(2)})`, `saturate(${(1 + H.red * 2.5).toFixed(2)})`, `hue-rotate(${(-25 * H.red).toFixed(0)}deg)`); if (H.white > 0) f.push(`brightness(${(1 + H.white * 1.8).toFixed(2)})`, `saturate(${(1 - H.white * .7).toFixed(2)})`); if (H.dark > 0) f.push(`brightness(${(1 - H.dark * .72).toFixed(2)})`, `contrast(${(1 + H.dark * .4).toFixed(2)})`);   // (films: the dying star dims toward an ember)
    if (f.length) ctx.filter = f.join(' ');
    try { return att0.call(this, dt); } finally { ctx.restore(); ctx.filter = 'none'; }
  };
  // the screen flash on top of the film
  const cine0 = M.drawCine;
  M.drawCine = function (ctx) { const r = cine0.call(this, ctx); const st = this.story; if (st && st.flash > 0) { ctx.save(); ctx.globalAlpha = Math.min(1, st.flash); ctx.fillStyle = '#fff6e6'; ctx.fillRect(0, 0, this.w, this.h); ctx.restore(); } return r; };
  // the film's passes: intro first; then stories at random, with the intro again every fourth pass
  const shots0 = M.cineShots;
  M.cineShots = function () {
    const c = this.cine, n = c.pass || 0;
    const SM = this.cineMode;
    if (!SM && (n === 0 || n % 4 === 3 || !this.storyOK())) return shots0.call(this);
    if (SM && !this.storyOK()) return shots0.call(this);
    let kind;
    if (SM) { const all = Object.keys(STORY_LEN); if (SM.first && !SM.started) { kind = SM.first; SM.started = true; SM.i = all.indexOf(kind); } else { SM.i = ((SM.i ?? -1) + 1) % all.length; kind = all[SM.i]; } }   // View ▸ Screen Saver Stories: one after another
    else kind = this.storyPick();
    return [{ k: 'story', story: kind, dur: STORY_LEN[kind], trans: 'fade', cap: 'story', capDur: 5, a: { s: 1 }, b: { s: 1 }, ease: 'linear' },
            { k: 'wide', trans: 'glide', cap: null, dur: 7, a: { s: .9, ox: 0, oy: 0, tilt: 0, spin: 0 }, b: { s: .7, ox: 0, oy: -20, tilt: .06, spin: -.15 }, ease: 'inOutQuad' }];
  };
  const next0 = M.cineNext;
  M.cineNext = function () {
    if (this.story) this.storyEnd();
    const r = next0.call(this); const S = this.cine && this.cine.shot;
    if (S && S.k === 'story') { S.tl = null; this.storyBegin(S.story); }
    if (S && S.open && S.sid && this.portals) { const P = this.portals.get(S.sid.slice(4)); if (P) P.peekUntil = this.time + S.dur - .6; }   // a group's intro: its sling-ring open while it's on screen
    return r;
  };
  const end0 = M.cineEnd;
  M.cineEnd = function () { if (this.story) this.storyEnd(); this.cineMode = null; return end0.call(this); };
  // the story's camera and clock
  const target0 = M.cineTarget;
  M.cineTarget = function (S) { if (S.k === 'story') { const st = this.story; return st ? { x: st.cam.x, y: st.cam.y } : null; } return target0.call(this, S); };
  const step0 = M.cineStep;
  M.cineStep = function (dt) {
    const st = this.story, c = this.cine;
    if (st && c && c.shot && c.shot.k === 'story' && c.phase !== 'out') {
      try { this.storyStep(dt); } catch (e) { console.warn('[story] stopped:', e && e.message); this.storyEnd(); return step0.call(this, dt); }
      const R = c.shot.rig, cam = st.cam;
      if (R) { R.s = cam.s; R.ox = cam.ox || 0; R.oy = cam.oy || 0; R.tilt = cam.tilt || 0; R.spin = cam.spin || 0; }
      if (c.shot.a) c.shot.a.s = c.shot.b.s = cam.s;
      if (st.cut) { st.cut = false; c.cur = null; c.from = null; }                 // a hard cut: the camera jumps, no glide
    }
    this.cineTalk = !!st;                                                        // speech bubbles stay on for a story
    const r = step0.call(this, dt);
    if (st && st.shakeAmp > .2 && this.cine) { const A = st.shakeAmp, cm = this.cam; cm.tx += (Math.random() - .5) * 2 * A; cm.ty += (Math.random() - .5) * 2 * A; cm.ttx = cm.tx; cm.tty = cm.ty; }
    return r;
  };
  // the episode's title card
  const cap0 = M.cineCapInfo;
  M.cineCapInfo = function (S) { if (S.cap === 'story') { const T = STORY_TITLES[S.story] || ['Episode', '']; return { title: true, k: 'Episode', n: T[0], m: T[1] }; } return cap0.call(this, S); };
}
