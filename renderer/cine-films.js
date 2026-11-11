// The screen saver's films (2026-10-30, Kevin: "at least 5 min per story, not boring, detailed, cinematic camera,
// dynamic; Endurance breaking, black hole sinking; the supernova redder, darker, exploding with the screen shaking").
// Five films, each ~5 minutes, each in acts (an act card opens every act) made of beats. A beat is one shot: its own
// camera (establishing wides with the system turning and the view craning, slow push-ins, tracking with lead,
// shot / reverse-shot close-ups for dialogue, crash zooms, Dutch tilts, screen shake) and its own action (where the
// probes fly, what they say, what happens to the star, the Endurance, the black hole, the bubbles). Consecutive beats
// hard-cut unless a beat says glide.
//   Supernova · The Heist · Endurance Down · Hide and Seek · Grand Prix
// Everything shown is the scene's: bubbles that get sucked into the black hole are stand-in copies (the real ones are
// hidden for the scene), a bubble that gets towed springs home on its own orbit afterwards, the Endurance's breach and
// drift is an offset on where it's drawn, the star's colour is a filter. The cine-stories.js engine runs it (actors,
// hide / restore, smooth ease-back when you come back). Loaded after cine-stories.js.

const FILMS = {};

Object.assign(Mesh.prototype, {
  // ---------------- the film engine ----------------
  filmStart(kind) {
    const F = FILMS[kind], st = this.story;
    st.film = F; st.bi = -1; st.b0 = 0; st.spin = 0; st.shakeAmp = 0; st.hideSids = new Set(); st.ghosts = []; st.sparks = []; st.chunks = []; st.flares = []; st.bolts = [];
    st.endFx = kind === 'endurance' ? { dx: 0, dy: 0, scale: 1, spin: 0, shake: 0 } : null; st.hideAll = null; st.speed = this.filmSpeed || 1;   // (Endurance Down: the station's offsets exist from the start)
  },
  filmStep(st, t, dt) {
    const F = st.film, beats = F.beats;
    let i = st.bi < 0 ? 0 : st.bi;
    while (i < beats.length - 1 && t >= beats[i]._t1) i++;
    if (i !== st.bi) {                                                           // a new shot
      const B = beats[i]; st.bi = i; st.b0 = B._t0; st.cut = B.cut !== false && i > 0; st.beat = B; st.bs = {};
      if (B.act) { if (i === 0) st.actAt = 6.5, st.actCard = B.act; else this.cineCaption({ cap: 'act', act: B.act, trans: 'whip', dur: 7, capDur: 6 }); }   // (the first act's card waits for the episode title)
      if (B.enter) B.enter.call(this, st, st.bs);
    }
    if (st.actAt && t >= st.actAt) { this.cineCaption({ cap: 'act', act: st.actCard, trans: 'whip', dur: 7, capDur: 6 }); st.actAt = 0; }
    const B = st.beat, bt = t - st.b0, u = Math.min(1, bt / B.d);
    st.shakeAmp = Math.max(0, st.shakeAmp - dt * 6);
    if (B.run) B.run.call(this, st, u, bt, dt, st.bs);
    if (B.say) for (const [who, at, text, h] of B.say) this.storySay(who, B._t0 + at, text, h);
    st.pov = B.pov ?? null;
    if (st.pov != null && st.actors[st.pov]) {                                   // the probe's own eyes: from where it is, looking where it's heading
      const p = this.actorAt(st, st.pov), P = st.actors[st.pov], sp = Math.hypot(p.vx, p.vy), h = sp > 30 ? Math.atan2(p.vy, p.vx) : (P.yaw != null ? Math.PI / 2 - P.yaw : -Math.PI / 2);
      if (st.povH == null || st.povWho !== st.pov) { st.povH = h; st.povWho = st.pov; } { let d = h - st.povH; d = Math.atan2(Math.sin(d), Math.cos(d)); st.povH += d * Math.min(1, dt * 2.5); }
      const ahead = 70 + Math.min(80, sp * .12);
      st.cam = { x: p.x + Math.cos(st.povH) * ahead, y: p.y + Math.sin(st.povH) * ahead, s: 1.55 + Math.min(.35, sp / 900), ox: 0, oy: 0, tilt: 0, spin: st.spin };   // (× the canvas's 1.42 fill scale)
    } else if (B.cam) { const c = B.cam.call(this, st, u, bt, st.bs); if (c) { st.cam = { ox: 0, oy: 0, tilt: 0, ...c, spin: st.spin }; } }
    if (st.pov == null) st.povWho = null;
    if (B.spin) st.spin += B.spin * dt;
    if (B.shake) st.shakeAmp = Math.max(st.shakeAmp, typeof B.shake === 'function' ? B.shake.call(this, st, u, bt) : B.shake);
    this.filmFx(st, dt);
  },
  // the scene's moving parts every frame: sparks, chunks, flares, bolts, ghosts sinking into the hole
  filmFx(st, dt) {
    const g = 160;
    st.sparks = st.sparks.filter(p => (p.life -= dt) > 0 && ((p.vy += g * dt * (p.g ?? 1)), (p.x += p.vx * dt), (p.y += p.vy * dt), true));
    st.chunks = st.chunks.filter(p => (p.life -= dt) > 0 && ((p.x += p.vx * dt), (p.y += p.vy * dt), (p.r += p.vr * dt), (p.vx *= Math.pow(.92, dt)), (p.vy *= Math.pow(.92, dt)), true));
    st.bolts = st.bolts.filter(b => st.t - b.t0 < (b.life || .45));
    st.flares = st.flares.filter(f => st.t - f.t0 < f.life);
  },
  // helpers the films use
  ring(a, r) { const k = this.orbitShape().k; return { x: this.hub.x + Math.cos(a) * r, y: this.hub.y + Math.sin(a) * r * k, z: Math.sin(a) }; },
  actorAt(st, i) { const P = st.actors[i]; return P ? { x: P.x, y: P.y, vx: P.vx || 0, vy: P.vy || 0 } : { x: this.hub.x, y: this.hub.y, vx: 0, vy: 0 }; },
  follow(st, i, s, lead = .35, extra = {}) { const p = this.actorAt(st, i); return { x: p.x + p.vx * lead, y: p.y + p.vy * lead, s, ...extra }; },
  between(st, i, j, s, extra = {}) { const a = this.actorAt(st, i), b = this.actorAt(st, j); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, s, ...extra }; },
  sparkBurst(st, x, y, n, col, sp = 220, life = .9) { for (let k = 0; k < n; k++) { const a = Math.random() * 6.2832, v = sp * (.3 + Math.random()); st.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - sp * .3, life: life * (.5 + Math.random()), c: col || (Math.random() < .5 ? '#ffcf6a' : '#ff7a2a'), s: 2 + Math.random() * 3 }); } },
  chunkBurst(st, x, y, n) { for (let k = 0; k < n; k++) { const a = Math.random() * 6.2832, v = 60 + Math.random() * 160; st.chunks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 6, vr: (Math.random() - .5) * 8, w: 4 + Math.random() * 9, h: 3 + Math.random() * 6, life: 6 + Math.random() * 6, c: Math.random() < .3 ? '#c9c2b0' : '#8e98a8' }); } },
  // a session bubble taken over by the scene (a stand-in copy drawn by drawStory; the real one hidden)
  ghostOf(st, n) { let G = st.ghosts.find(g => g.n === n); if (!G) { G = { n, x: n.x, y: n.y, gs: 1, rot: 0, stretch: 1, alpha: 1 }; st.ghosts.push(G); st.hideSids.add(n.sid); } return G; },
  ghostRelease(st, n) { st.ghosts = st.ghosts.filter(g => g.n !== n); st.hideSids.delete(n.sid); },
  sayAs(st, i, text, h = 'working') { const P = st.actors[i]; if (P) P.say = { text, health: h, name: this.probeName ? this.probeName(P) : 'Probe', t0: this.time, hold: this.time + Math.max(2.2, text.length * .055) }; },
  // shot / reverse shot: alternate close-ups on whoever's talking
  dialogue(lines, gap = 4.2) {   // lines: [[who, text, health]] → { d, say, cam }
    return {
      d: lines.length * gap + 1,
      say: lines.map(([w, x, h], k) => [w, .4 + k * gap, x, h]),
      cam(st, u, bt) { const k = Math.min(lines.length - 1, Math.floor(bt / gap)), w = lines[k][0]; if (st.lastSpeaker !== w) { st.lastSpeaker = w; st.cut = true; } const p = this.actorAt(st, w); return { x: p.x, y: p.y + 10, s: 2.1 + .12 * ((bt % gap) / gap), ox: (w % 2 ? -1 : 1) * 70, tilt: (w % 2 ? .03 : -.03) }; },
    };
  },
});

// ======================================================================================================== the films
// (a: act card; d: seconds; cam(st, u, bt) → { x, y, s, ox, oy, tilt }; run(st, u, bt, dt, bs); say: [[actor, at, text,
// health]]; spin: system turn rad/s; shake: px; cut: false = glide from the last shot)
const sec = (beats) => { let t = 0; for (const B of beats) { B._t0 = t; t += B.d; B._t1 = t; } return t; };

// ---------- 1. Supernova ----------
FILMS.supernova = { title: 'Supernova', tagline: 'Every star dies. This one takes the yard with it', need: 3, beats: [
  { act: ['Act I', 'Something\'s wrong with the sun'], d: 18, spin: .05, enter(st) { st.H = { red: 0, dark: 0, white: 0, starS: 1 }; this.storyHide = Object.assign(this.storyHide || {}, { bub: false, end: false, probe: false, star: false, starS: 1, red: 0, white: 0, dark: 0 }); },
    run(st, u) { const r = this.orbitShape().rx; [0, 1, 2].forEach(i => { const p = this.ring(1 + i * 2.1 + u * .6, r * (1.05 - i * .07)); this.storyGo(i, p.x, p.y - 30, { k: 1.4, max: 160 }); }); },
    cam(st, u) { return { x: this.hub.x, y: this.hub.y, s: .55 + .12 * u, tilt: .12 * (1 - u) }; }, say: [[0, 5, 'Quiet shift. I like quiet.'], [1, 11, 'Quiet makes me nervous, boss.']] },
  { d: 12, run(st, u) { this.storyHide.red = .08 + .04 * Math.sin(st.t * 3); }, cam(st, u) { return { x: this.hub.x, y: this.hub.y, s: 1.55 + .3 * u }; }, say: [[2, 3, 'Uh… the sun just flickered.'], [2, 8, 'Twice.']] },
  { d: 15, run(st, u) { const H = this.hub, M = this.motherRadius(); this.storyGo(0, H.x - M * 2.2, H.y + M * .8, { k: 2 }); this.storyGo(1, H.x + M * 2.2, H.y + M * .8, { k: 2 }); this.storyGo(2, H.x, H.y + M * 2.1, { k: 2 }); },
    ...(() => { const D = Mesh.prototype.dialogue([[1, 'Readings say the core\'s cooling. Fast.'], [0, 'Stars don\'t just cool, kid.'], [1, 'This one\'s cooling like my coffee in solitary.']], 4.6); return { say: D.say, cam: D.cam }; })() },
  { d: 14, run(st, u, bt) { const H = this.hub, M = this.motherRadius(); this.storyGo(2, H.x + M * .3, H.y - M - 60, { k: 3, scanOn: bt > 5 ? { x: H.x, y: H.y, R: M } : null }); }, cam(st, u) { return this.follow(st, 2, 1.7 - .3 * u, .25, { tilt: -.05 }); }, say: [[2, 6, 'Scanning… temperature dropping, mass climbing.'], [2, 10.5, 'That ain\'t a math problem, that\'s a death certificate.', 'error']] },
  { d: 12, cut: false, run(st, u) { this.storyHide.red = .12 + .13 * u; }, cam(st, u) { return { x: this.hub.x, y: this.hub.y, s: .8 - .1 * u, tilt: -.1 * u }; }, spin: .08 },
  // Act II
  { act: ['Act II', 'Red Giant'], d: 16, run(st, u) { const H = this.storyHide; H.red = .25 + .25 * u; H.starS = 1 + .25 * u; if (Math.random() < .03) st.flares.push({ t0: st.t, a: Math.random() * 6.28, life: 2.5, len: 1.5 + Math.random() }); }, cam(st, u) { return { x: this.hub.x, y: this.hub.y, s: 1.2 + .35 * u, tilt: .04 }; } },
  { ...(() => { const D = Mesh.prototype.dialogue([[0, 'It\'s swelling. Everybody back off the core!', 'error'], [2, 'Back off to where? It\'s the SUN!', 'error'], [1, 'I knew I shoulda stayed in prison.']], 4); return D; })(), run(st) { const H = this.storyHide; H.red = Math.min(.6, H.red + .002); } },
  { d: 18, enter(st, bs) { const L = this.storyNodes(); bs.n = L[0]; bs.m = L[1]; }, run(st, u, bt, dt, bs) { const H = this.hub, E = this.endGeom();
      for (const [i, n] of [[0, bs.n], [1, bs.m]]) if (n) { n.dragging = true; st.held.includes(n) || st.held.push(n); const P = st.actors[i], tx = n.x + (E.x - n.x) * .35 * u, ty = n.y + (E.y - n.y) * .35 * u; this.storyGo(i, tx, ty - 70, { k: 2, max: 140 }); n.x += (P.x - n.x) * Math.min(1, dt * 2); n.y += (P.y + 70 - n.y) * Math.min(1, dt * 2); st.tether = [P, n]; }
      this.storyHide.red = Math.min(.7, this.storyHide.red + dt * .01); },
    cam(st, u) { return this.follow(st, 0, 1.25, .3, { oy: 40 }); }, say: [[0, 2, 'Evacuate the bunks! Haul \'em toward the Endurance!'], [1, 9, 'This one weighs a fucking ton!'], [0, 14, 'Move it or melt, Mk I!']] },
  { d: 16, enter(st) { st.tether = null; for (const n of st.held) n.dragging = false; st.held = []; }, run(st, u) { const H = this.storyHide; H.red = .6 + .2 * u; H.starS = 1.25 + .35 * u; if (Math.random() < .05) st.flares.push({ t0: st.t, a: Math.random() * 6.28, life: 3, len: 2 + Math.random() * 1.5 }); }, cam(st, u) { return { x: this.hub.x, y: this.hub.y, s: .7 - .12 * u, tilt: -.08 }; }, spin: .12, shake: .6 },
  { d: 14, run(st, u) { const E = this.endGeom(); [0, 1, 2].forEach(i => this.storyGo(i, E.x + (i - 1) * 50, E.y + E.size * .45, { k: 2.5 })); }, cam(st, u) { const E = this.endGeom(); return { x: E.x, y: E.y + 20, s: 1.5 + .2 * u, tilt: .05 }; }, say: [[0, 2, 'Endurance! Open the bay, we\'re coming in hot!'], [2, 7.5, 'It\'s… it\'s turning dark red.'], [1, 11, 'Dark is bad. Dark is very fucking bad.', 'error']] },
  { d: 14, cut: false, run(st, u) { const H = this.storyHide; H.red = .8 + .2 * u; H.dark = .5 * u; }, cam(st, u) { return { x: this.hub.x, y: this.hub.y, s: .55 + .25 * u, tilt: .1 * u }; }, shake: (st, u) => .5 + u * 1.5 },
  // Act III
  { act: ['Act III', 'Collapse'], d: 12, run(st, u) { const H = this.storyHide; H.dark = .5 + .35 * u; H.starS = 1.6 + .08 * Math.sin(st.t * (4 + u * 10)); }, cam(st, u) { return { x: this.hub.x, y: this.hub.y, s: 1.4 + .4 * u }; }, shake: (st, u) => 1 + u * 3, say: [[2, 4, 'It stopped flaring…'], [0, 8.5, 'It\'s gone quiet. Too quiet.', 'error']] },
  { d: 8, cam(st, u, bt) { const w = Math.floor(bt / 2) % 3; if (st.lastW !== w) { st.lastW = w; st.cut = true; } return this.follow(st, w, 2.3, 0, { tilt: (w - 1) * .05 }); }, shake: 3,
    say: [[0, .2, 'GET DOWN!', 'error'], [1, 2.2, 'Mama…', 'error'], [2, 4.2, 'I didn\'t even get to retire!', 'error'], [0, 6.2, 'BRACE!', 'error']] },
  { d: 10, run(st, u) { const H = this.storyHide; H.starS = 1.68 - 1.35 * Math.pow(u, 2.2); H.white = Math.pow(u, 3) * .9; H.dark = .85 * (1 - u); }, cam(st, u) { return { x: this.hub.x, y: this.hub.y, s: 1.2 + 1.6 * Math.pow(u, 3) }; }, shake: (st, u) => 3 + u * 8 },
  { d: 4, run(st, u) { st.blackout = 1 - u * .3; }, cam() { return { x: this.hub.x, y: this.hub.y, s: 2.8 }; } },
  // Act IV
  { act: ['Act IV', 'Supernova'], d: 6, enter(st) { st.blackout = 0; this.snBoom(st); }, cam(st, u) { return { x: this.hub.x, y: this.hub.y, s: 2.4 - 1.9 * Math.min(1, u * 2) }; }, shake: (st, u) => 22 * (1 - u) + 4 },
  { d: 14, run(st, u, bt, dt) { this.snParts(st, dt, 0); }, cam(st, u) { return { x: this.hub.x, y: this.hub.y, s: .45 + .05 * u }; }, spin: .06, shake: (st, u) => 3 * (1 - u) },
  { d: 20, run(st, u, bt, dt) { this.snParts(st, dt, Math.min(1, u * 1.5)); }, cam(st, u) { const B = this.bhGeom(); return { x: B.x, y: B.y, s: .8 + .7 * u, tilt: .06 }; } },
  { d: 16, cut: false, run(st, u, bt, dt) { this.snParts(st, dt, 1); }, cam(st, u) { const B = this.bhGeom(); return { x: (B.x + this.hub.x) / 2, y: (B.y + this.hub.y) / 2, s: .55 }; }, spin: -.05 },
  // Act V
  { act: ['Act V', 'Rebirth'], d: 14, run(st, u, bt, dt) { this.snParts(st, dt, 1, true); st.nebula = Math.max(.15, 1 - u * .85); st.proto = u; }, cam(st, u) { return { x: this.hub.x, y: this.hub.y, s: .7 + .5 * u }; } },
  { d: 8, enter(st) { st.flash = .7; st.fx.push({ k: 'birth', t0: st.t, life: 2.5 }); }, run(st, u) { const H = this.storyHide; H.star = false; H.starS = Math.min(1, u * 1.2); H.white = .6 * (1 - u); H.red = 0; H.dark = 0; st.nebula = .15 * (1 - u); st.proto = 1 - u; }, cam(st, u) { return { x: this.hub.x, y: this.hub.y, s: 1.6 - .4 * u }; }, shake: (st, u) => 4 * (1 - u) },
  { d: 16, enter(st) { this.snRebuild(st); }, run(st, u, bt) { this.snReveal(st, bt); }, cam(st, u) { return { x: this.hub.x, y: this.hub.y, s: .85, tilt: -.06 * u }; }, spin: .05 },
  { d: 16, run(st, u) { const H = this.hub, M = this.motherRadius(); this.storyGo(0, H.x - M * 2, H.y + M * 1.1, { k: 2 }); this.storyGo(1, H.x + M * 2, H.y + M * 1.1, { k: 2 }); this.storyGo(2, H.x, H.y + M * 2.2, { k: 2 }); this.storyHide.bub = false; },
    ...(() => { const D = Mesh.prototype.dialogue([[1, 'Did… did we just die?'], [0, 'New star. New paint. Same shitty job.'], [2, 'I\'m putting in for a transfer.']], 5); return { say: D.say, cam: D.cam }; })() },
] };

// ---------- 2. The Heist ----------
FILMS.heist = { title: 'The Heist', tagline: 'Two cons, one fat bubble, and a very hungry black hole', need: 3, beats: [
  { act: ['Act I', 'The Plan'], d: 16, spin: .06, run(st, u) { const r = this.orbitShape().rx; this.storyGo(0, this.ring(-1 + u, r).x, this.ring(-1 + u, r).y - 30, { k: 1.2, max: 140 }); const B = this.bhGeom(); this.storyGo(1, B.x + 140, B.y - 60, { k: 2 }); this.storyGo(2, B.x + 200, B.y - 30, { k: 2 }); },
    cam(st, u) { return { x: this.hub.x, y: this.hub.y, s: .5 + .15 * u, tilt: .1 - .1 * u }; }, say: [[0, 4, 'Night shift. Nothing ever happens on night shift.']] },
  { ...Mesh.prototype.dialogue([[1, 'See that one? The fat one. Nobody\'d miss it.'], [2, 'You wanna steal a SESSION? Are you nuts?'], [1, 'Feed it to the hole, sell the tokens. Easy money.'], [2, 'And the Chief?'], [1, 'Chief\'s on patrol. He won\'t see shit.']], 4.4), run(st) { const B = this.bhGeom(); this.storyGo(1, B.x + 120, B.y - 70, { k: 2 }); this.storyGo(2, B.x + 210, B.y - 50, { k: 2 }); } },
  { d: 12, enter(st) { const L = this.storyNodes(), B = this.bhGeom(); st.loot = L.sort((a, b) => this.nodeRadius(b) - this.nodeRadius(a))[0]; }, run(st, u) { const r = this.orbitShape().rx; const p = this.ring(-.4 + u * .5, r * 1.1); this.storyGo(0, p.x, p.y - 40, { k: 1.5 }); }, cam(st, u) { return this.follow(st, 0, 1.6, .3, { tilt: .04 }); }, say: [[0, 3, 'Bunk C… bunk D… all quiet. Good.'], [0, 8, 'Maybe I\'ll catch a nap later.']] },
  { d: 12, run(st, u) { const n = st.loot; if (!n) return; this.storyGo(1, n.x + Math.cos(st.t) * 120, n.y + Math.sin(st.t) * 50 - 30, { k: 3 }); }, cam(st, u) { const n = st.loot; return n ? { x: n.x, y: n.y, s: 1.9 - .3 * u, ox: 60 } : null; }, say: [[1, 4, 'Look at you. All those juicy tokens.']] },
  { d: 15, cut: false, cam(st, u) { const n = st.loot, B = this.bhGeom(); return n ? { x: (n.x + B.x) / 2, y: (n.y + B.y) / 2, s: .75, tilt: -.15 } : null; }, spin: -.05, say: [[2, 6, 'This is a terrible idea.'], [1, 11, 'All my ideas are terrible. That\'s why they work.']] },
  // Act II
  { act: ['Act II', 'The Grab'], d: 14, run(st, u) { const n = st.loot; if (!n) return; this.storyGo(1, n.x, n.y - this.nodeRadius(n) - 70, { k: 1, max: 70 }); }, cam(st, u) { return this.follow(st, 1, 2, .2, { ox: -60, tilt: .05 }); }, say: [[1, 5, 'Easy… easy…'], [2, 10, '(whispering) Hurry the fuck up.']] },
  { d: 8, enter(st) { const n = st.loot; if (n) { n.dragging = true; st.held.push(n); st.tether = [st.actors[1], n]; st.fx.push({ k: 'zap', t0: st.t, x: n.x, y: n.y, life: .6 }); } }, run(st, u, bt, dt) { this.heistTow(st, 1, dt, 0); }, cam(st, u) { const n = st.loot; return n ? { x: n.x, y: n.y - 30, s: 2.2 + .3 * u } : null; }, say: [[1, 1, 'Got it! Go go go!']], shake: 1 },
  { d: 18, run(st, u, bt, dt) { this.heistTow(st, 1, dt, u * .65); this.storyGo(2, st.actors[1].x + 70, st.actors[1].y - 30, { k: 3 }); }, cam(st, u) { return this.follow(st, 1, 1.3, .5, { tilt: -.04 }); }, say: [[2, 4, 'To the hole! Before the Chief—'], [1, 10, 'Nobody steals like I steal!']] },
  { d: 6, cam(st) { return this.follow(st, 0, 2.6, 0); }, say: [[0, .3, 'HEY! That\'s MY bunk you\'re dragging, assholes!', 'error']], shake: 1.5 },
  { d: 20, run(st, u, bt, dt) { this.heistTow(st, 1, dt, .65 + u * .3); const T = st.actors[1], C = st.actors[0]; this.storyGo(0, T.x - 80 + Math.sin(st.t * 3) * 40, T.y - 40, { k: 4, max: 520 }); this.storyGo(2, (T.x + C.x) / 2 + Math.cos(st.t * 4) * 60, (T.y + C.y) / 2 + Math.sin(st.t * 4) * 40, { k: 6, max: 600 });
      if (Math.random() < dt * 1.6) st.bolts.push({ t0: st.t, from: st.actors[2], to: st.actors[0], col: '#5ac8ff' }); },
    cam(st, u, bt) { const w = Math.floor(bt / 5) % 2; if (st.lastW !== w) { st.lastW = w; st.cut = true; } return w ? this.follow(st, 0, 1.4, .4, { tilt: .06 }) : this.follow(st, 1, 1.4, .4, { tilt: -.06 }); },
    say: [[2, 2, 'I\'ll hold him off!'], [0, 7, 'Out of my way, Mk II!', 'error'], [2, 12, 'Pew pew, motherfucker!'], [0, 16, 'You\'re both doing hard time for this!', 'error']] },
  { d: 9, run(st, u, bt, dt) { this.heistTow(st, 1, dt, 1); }, cam(st, u) { const B = this.bhGeom(); return { x: B.x, y: B.y, s: 1 + .4 * u }; }, say: [[1, 3, 'Say goodbye, fatty!']] },
  // Act III
  { act: ['Act III', 'Event Horizon'], d: 20, enter(st) { const n = st.loot; if (n) { n.dragging = false; st.held = []; const G = this.ghostOf(st, n); const B = this.bhGeom(); G.r = Math.hypot(G.x - B.x, G.y - B.y); G.a = Math.atan2(G.y - B.y, G.x - B.x); } st.tether = null; },
    run(st, u, bt, dt) { this.heistSink(st, dt, .55); this.storyGo(1, this.bhGeom().x + 180, this.bhGeom().y - 120, { k: 2 }); }, cam(st, u) { const B = this.bhGeom(); return { x: B.x, y: B.y, s: 1.6 + .3 * u, tilt: .04 * Math.sin(st.t) }; }, shake: 1.5, say: [[1, 3, 'Look at it go. Like a noodle.'], [2, 9, 'Is it… screaming?'], [1, 15, 'Sessions don\'t scream, dumbass.']] },
  { d: 20, run(st, u, bt, dt) { const B = this.bhGeom(), G = st.ghosts[0]; this.storyGo(0, B.x + (G ? Math.cos(G.a) * (G.r + 90) : 120), B.y + (G ? Math.sin(G.a) * (G.r + 90) : -90), { k: 5, max: 600, scanOn: G ? { x: G.x, y: G.y, R: 40 } : null }); this.heistSink(st, dt, .25 * Math.sin(st.t * 1.3) - .05); },
    cam(st, u, bt) { const w = Math.floor(bt / 4) % 2; if (st.lastW !== w) { st.lastW = w; st.cut = true; } const B = this.bhGeom(); return w ? this.follow(st, 0, 2, 0, { tilt: .08 }) : { x: B.x, y: B.y, s: 1.4 }; }, shake: 3,
    say: [[0, 1, 'Hold on, kid! I got you!'], [0, 8, 'Tractor beam at max! Come ON!', 'error'], [0, 15, 'Gravity\'s a bitch but I\'m a bigger one!']] },
  { d: 15, run(st, u, bt, dt) { const B = this.bhGeom(), T = st.actors[1]; this.heistSink(st, dt, .1); this.storyGo(1, B.x + Math.cos(st.t * 2) * (90 - 40 * u), B.y + Math.sin(st.t * 2) * (60 - 30 * u), { k: 6, max: 500, spin: 8 }); },
    cam(st, u) { return this.follow(st, 1, 2.1, 0, { tilt: -.1 }); }, shake: 4, say: [[1, 1, 'Wait— it\'s got ME now!', 'error'], [1, 6, 'BOSS! BOSS, HELP!', 'error'], [0, 11, 'You owe me, you little shit.']] },
  { d: 15, run(st, u, bt, dt) { const B = this.bhGeom(); this.heistSink(st, dt, -1.2 * u); this.storyGo(2, B.x + 150, B.y - 90, { k: 3 }); this.storyGo(1, B.x + 150 + 60 * u, B.y - 60 - 40 * u, { k: 3 }); },
    cam(st, u) { const B = this.bhGeom(); return { x: B.x + 60, y: B.y - 40, s: 1.25 - .2 * u }; }, shake: (st, u) => 3 * (1 - u), say: [[2, 2, 'I got Mk I! Pull, Chief!'], [0, 8, 'Heave, motherfuckers, HEAVE!']] },
  { d: 10, enter(st) { st.flash = .4; }, run(st, u, bt, dt) { this.heistSink(st, dt, -2.5); }, cam(st, u) { return this.follow(st, 0, 1.2 - .3 * u, .6); }, shake: (st, u) => 6 * (1 - u), say: [[0, 1, 'SLINGSHOT!']] },
  // Act IV
  { act: ['Act IV', 'Judgment'], d: 18, enter(st) { const G = st.ghosts[0]; if (G) { this.ghostRelease(st, G.n); } }, run(st, u) { const H = this.hub, M = this.motherRadius(); this.storyGo(0, H.x, H.y + M * 1.8, { k: 2 }); this.storyGo(1, H.x - 80, H.y + M * 2.2, { k: 2 }); this.storyGo(2, H.x + 80, H.y + M * 2.2, { k: 2 }); },
    cam(st, u) { return { x: this.hub.x, y: this.hub.y + 60, s: .9 + .3 * u }; }, say: [[0, 5, 'Bunk\'s back on its orbit. No thanks to you two.']] },
  { ...Mesh.prototype.dialogue([[0, 'Grand larceny. Attempted session-icide.'], [1, 'It was his idea!'], [2, 'It was NOT my idea!'], [0, 'Shut it. Both of you scrub the Endurance. With your tongues.'], [1, 'We don\'t have tongues…'], [0, 'Then figure it out.']], 4) },
  { d: 14, run(st, u) { const E = this.endGeom(); [1, 2].forEach(i => this.storyGo(i, E.x + Math.cos(st.t * 1.5 + i * 3) * E.size * .5, E.y + Math.sin(st.t * 1.5 + i * 3) * E.size * .25, { k: 3 })); if (Math.random() < .2) this.sparkBurst(st, st.actors[1].x, st.actors[1].y + 10, 2, '#bff3ff', 80, .5); },
    cam(st, u) { const E = this.endGeom(); return { x: E.x, y: E.y, s: 1.6 }; }, say: [[1, 4, 'Scrub scrub scrub…'], [2, 9, 'I hate you.']] },
  { d: 16, cut: false, cam(st, u) { return { x: this.hub.x, y: this.hub.y, s: .7 - .15 * u, tilt: .12 * u }; }, spin: .1, say: [[0, 6, 'Night shift. Nothing ever happens on night shift.']] },
] };

// ---------- 3. Endurance Down ----------
FILMS.endurance = { title: 'Endurance Down', tagline: 'Hull breach. Course: the black hole', need: 3, beats: [
  { act: ['Act I', 'Routine Maintenance'], d: 16, spin: .05, run(st, u) { const E = this.endGeom(); [0, 1, 2].forEach(i => this.storyGo(i, E.x + (i - 1) * 90 + Math.sin(st.t + i) * 10, E.y + E.size * .55, { k: 1.5 })); }, cam(st, u) { return { x: this.hub.x, y: this.hub.y, s: .55 + .1 * u, tilt: .08 }; }, say: [[0, 6, 'Maintenance day. Grab a wrench and look busy.']] },
  { d: 14, run(st, u) { const E = this.endGeom(); [0, 1, 2].forEach(i => this.storyGo(i, E.x + Math.cos(st.t * .6 + i * 2.1) * E.size * .6, E.y + Math.sin(st.t * .6 + i * 2.1) * E.size * .3, { k: 2 })); if (Math.random() < .15) this.sparkBurst(st, st.actors[1].x, st.actors[1].y + 8, 3, '#bff3ff', 90, .5); },
    cam(st, u) { const E = this.endGeom(); return { x: E.x, y: E.y, s: 1.3 + .4 * u, ox: 40 }; }, say: [[1, 3, 'Ring module four is making that noise again.'], [2, 9, 'What noise?']] },
  { ...Mesh.prototype.dialogue([[1, 'The "I\'m about to explode" noise.'], [0, 'That\'s just the coolant pump.'], [1, 'The coolant pump doesn\'t usually say "WARNING".'], [0, '…Huh.']], 4.2) },
  { d: 12, cam(st, u) { const E = this.endGeom(); return { x: E.x, y: E.y, s: 2.2 - .2 * u }; }, run(st) { st.alarm = .3 + .3 * Math.sin(st.t * 6); } },
  { d: 10, enter(st) { st.endFx = { dx: 0, dy: 0, scale: 1, spin: 0, shake: 4 }; st.alarm = 1; const E = this.endGeom(); this.sparkBurst(st, E.x, E.y, 40); this.chunkBurst(st, E.x, E.y, 10); st.flash = .35; }, run(st, u) { st.alarm = .6 + .4 * Math.sin(st.t * 9); }, cam(st, u) { const E = this.endGeom(); return { x: E.x, y: E.y, s: 1.6 }; }, shake: 8, say: [[0, .5, 'BREACH! Hull breach!', 'error'], [2, 4, 'Mama!', 'error']] },
  // Act II
  { act: ['Act II', 'Hull Breach'], d: 14, run(st, u, bt, dt) { const E = this.endGeom(); st.alarm = .6 + .4 * Math.sin(st.t * 9); st.endFx.shake = 2.5; if (Math.random() < dt * 6) this.sparkBurst(st, E.x + (Math.random() - .5) * E.size * .6, E.y + (Math.random() - .5) * E.size * .3, 8); if (Math.random() < dt * 1.5) this.chunkBurst(st, E.x, E.y, 2); },
    cam(st, u, bt) { const w = Math.floor(bt / 3.5) % 3, E = this.endGeom(); if (st.lastW !== w) { st.lastW = w; st.cut = true; } return w === 0 ? { x: E.x, y: E.y, s: 2.4 } : w === 1 ? this.follow(st, 1, 2.2, 0) : { x: E.x - 60, y: E.y + 40, s: 1.8, tilt: .1 }; }, shake: 2.5, say: [[1, 2, 'We\'re losing pieces!'], [0, 7, 'Seal it! SEAL IT!', 'error']] },
  { d: 16, run(st, u, bt, dt) { const E0 = this.endGeom(), B = this.bhGeom(); st.endFx.dx += (B.x - (E0.x)) * dt * .018; st.endFx.dy += (B.y - (E0.y)) * dt * .018; st.endFx.spin += dt * .8; st.alarm = .6 + .4 * Math.sin(st.t * 9); if (Math.random() < dt * 2) this.chunkBurst(st, E0.x, E0.y, 1);
      const E = this.endGeom(); [0, 1, 2].forEach(i => this.storyGo(i, E.x + (i - 1) * 110, E.y - E.size * .4, { k: 3, max: 400 })); },
    cam(st, u) { const E = this.endGeom(); return { x: E.x, y: E.y, s: .95, tilt: -.1 }; }, spin: -.04, say: [[2, 3, 'Uh, Chief? Why are we… moving?'], [0, 9, 'The thrusters blew. It\'s drifting.', 'error'], [1, 13, 'Drifting where?']] },
  { d: 12, cam(st, u, bt) { const w = Math.floor(bt / 3) % 3; if (st.lastW !== w) { st.lastW = w; st.cut = true; } return this.follow(st, w, 2.4, 0, { tilt: (w - 1) * .06 }); }, run(st, u, bt, dt) { this.endDrift(st, dt, .018); }, say: [[0, .5, '…'], [1, 3.2, 'Oh no.'], [2, 6.2, 'Oh no no no.', 'error'], [0, 9.2, 'The hole.', 'error']] },
  { d: 14, run(st, u, bt, dt) { this.endDrift(st, dt, .02); }, cam(st, u) { const E = this.endGeom(), B = this.bhGeom(); return { x: (E.x + B.x) / 2, y: (E.y + B.y) / 2, s: .6 + .05 * u }; }, spin: .05 },
  { d: 12, enter(st) { const L = this.storyNodes(); st.hit = L[Math.floor(L.length / 2)]; }, run(st, u, bt, dt) { this.endDrift(st, dt, .02); const n = st.hit; if (n && bt > 4 && !st.hitDone) { st.hitDone = true; n.vx += 900; n.vy -= 500; this.sparkBurst(st, n.x, n.y, 20, '#ffffff'); this.chunkBurst(st, n.x, n.y, 5); st.flash = .2; } },
    cam(st, u) { const n = st.hit; return n ? { x: n.x, y: n.y, s: 1.6 } : null; }, shake: (st, u, bt) => bt > 4 && bt < 6 ? 7 : 1, say: [[1, 5, 'It hit Bunk F! Bunk F is spinning!']] },
  // Act III
  { act: ['Act III', 'The Pull'], d: 18, run(st, u, bt, dt) { this.endDrift(st, dt, .022); st.endFx.scale = Math.max(.8, 1 - u * .2); const E = this.endGeom(); [0, 1, 2].forEach(i => this.storyGo(i, E.x + (i - 1) * 120, E.y - E.size * .5 - 40, { k: 4, max: 520 })); },
    cam(st, u) { const E = this.endGeom(); return { x: E.x, y: E.y, s: 1.3, tilt: .12 * Math.sin(st.t * .7) }; }, shake: 3, say: [[0, 2, 'Tethers! Everybody grab a mooring point!'], [2, 8, 'And pull it against a BLACK HOLE?'], [0, 13, 'You got a better plan, Mk II?']] },
  { d: 16, enter(st) { st.tethers = [0, 1, 2]; }, run(st, u, bt, dt) { this.endDrift(st, dt, .008); const E = this.endGeom(), B = this.bhGeom(), ax = E.x - B.x, ay = E.y - B.y, d = Math.hypot(ax, ay) || 1; [0, 1, 2].forEach(i => this.storyGo(i, E.x + ax / d * 170 + (i - 1) * 60 * -ay / d, E.y + ay / d * 170 + (i - 1) * 60 * ax / d, { k: 5, max: 600 })); },
    cam(st, u) { const E = this.endGeom(); return { x: E.x, y: E.y, s: 1.1, ox: 50, tilt: -.06 }; }, shake: 4, say: [[1, 3, 'Thrusters at max!'], [2, 9, 'It\'s not slowing down!', 'error'], [0, 13, 'Then we pull HARDER, goddamn it!']] },
  { d: 20, run(st, u, bt, dt) { const E0 = this.endGeom(), B = this.bhGeom(); st.endFx.dx -= (B.x - E0.x) * dt * .006 * u; st.endFx.dy -= (B.y - E0.y) * dt * .006 * u; const E = this.endGeom(), ax = E.x - B.x, ay = E.y - B.y, d = Math.hypot(ax, ay) || 1; [0, 1, 2].forEach(i => this.storyGo(i, E.x + ax / d * (170 + 30 * u) + (i - 1) * 60 * -ay / d, E.y + ay / d * (170 + 30 * u) + (i - 1) * 60 * ax / d, { k: 5, max: 600 })); if (Math.random() < dt * 4) this.sparkBurst(st, st.actors[Math.random() * 3 | 0].x, st.actors[Math.random() * 3 | 0].y, 4); },
    cam(st, u, bt) { const w = Math.floor(bt / 5) % 2; if (st.lastW !== w) { st.lastW = w; st.cut = true; } const E = this.endGeom(); return w ? this.follow(st, 0, 2.3, 0, { tilt: .1 }) : { x: E.x, y: E.y, s: .95 }; }, shake: 5, say: [[0, 2, 'HEAVE!'], [1, 7, 'It\'s… it\'s moving! Our way!'], [2, 13, 'My engines are melting, boss!', 'error'], [0, 17, 'KEEP PULLING!', 'error']] },
  { d: 10, enter(st) { st.tethers = [0, 1]; st.flash = .3; const P = st.actors[2]; this.sparkBurst(st, P.x, P.y, 25, '#9fd8ff'); P.vx = 600; P.vy = 300; }, run(st, u, bt, dt) { this.storyGo(2, st.actors[2].x + 30, st.actors[2].y + 10, { k: .3, spin: 10 }); }, cam(st, u) { return this.follow(st, 2, 1.8, 0); }, shake: 6, say: [[2, .5, 'My tether snapped!', 'error'], [0, 5, 'Mk II, get back on the line!']] },
  { d: 14, enter(st) { st.tethers = [0, 1, 2]; }, run(st, u, bt, dt) { const E0 = this.endGeom(), B = this.bhGeom(); st.endFx.dx -= (B.x - E0.x) * dt * .012; st.endFx.dy -= (B.y - E0.y) * dt * .012; const E = this.endGeom(), ax = E.x - B.x, ay = E.y - B.y, d = Math.hypot(ax, ay) || 1; [0, 1, 2].forEach(i => this.storyGo(i, E.x + ax / d * 200 + (i - 1) * 60 * -ay / d, E.y + ay / d * 200 + (i - 1) * 60 * ax / d, { k: 5, max: 600 })); },
    cam(st, u) { const E = this.endGeom(); return { x: E.x, y: E.y, s: .8 + .2 * u, tilt: .05 }; }, shake: (st, u) => 4 * (1 - u), say: [[0, 3, 'We\'re clear! We\'re out of the pull!'], [1, 9, 'Holy shit, it worked.']] },
  // Act IV
  { act: ['Act IV', 'Repairs'], d: 16, enter(st) { st.tethers = null; }, run(st, u) { st.endFx.dx *= .985; st.endFx.dy *= .985; st.endFx.scale += (1 - st.endFx.scale) * .02; st.endFx.shake = 1.2 * (1 - u); const E = this.endGeom(); [0, 1, 2].forEach(i => this.storyGo(i, E.x + (i - 1) * 90, E.y - E.size * .45, { k: 2.5 })); },
    cam(st, u) { const E = this.endGeom(); return { x: E.x, y: E.y, s: .9 + .3 * u }; }, spin: .04, say: [[0, 6, 'Home sweet home. Mostly.']] },
  { d: 20, run(st, u, bt, dt) { const E = this.endGeom(); [0, 1, 2].forEach(i => { const a = st.t * (1 + i * .3) + i * 2; this.storyGo(i, E.x + Math.cos(a) * E.size * .45, E.y + Math.sin(a) * E.size * .2, { k: 4 }); if (Math.random() < dt * 3) this.sparkBurst(st, st.actors[i].x, st.actors[i].y + 10, 4, '#bff3ff', 120, .45); }); st.alarm = Math.max(0, .5 - u * .5); },
    cam(st, u, bt) { const w = Math.floor(bt / 4) % 4, E = this.endGeom(); if (st.lastW !== w) { st.lastW = w; st.cut = true; } return w === 3 ? { x: E.x, y: E.y, s: 1.5, tilt: .08 } : this.follow(st, w, 2.4, 0, { tilt: (w - 1) * .05 }); }, say: [[1, 2, 'Welding the ring seam…'], [2, 7, 'Patching the hull with… is this gum?'], [0, 12, 'Don\'t ask questions. Just weld.'], [1, 17, 'Ring module four: online.']] },
  { d: 12, enter(st) { st.alarm = 0; st.endFx.shake = 0; st.glowOk = 1; }, run(st, u) { st.endFx.dx *= .97; st.endFx.dy *= .97; }, cam(st, u) { const E = this.endGeom(); return { x: E.x, y: E.y, s: 1.8 - .3 * u }; }, say: [[0, 3, 'Lights are green.'], [2, 8, 'We did it. We actually did it.']] },
  { d: 10, run(st, u) { st.endFx.spin = st.endFx.spin * .98; st.endFx.dx *= .95; st.endFx.dy *= .95; }, cam(st, u) { const E = this.endGeom(); return { x: E.x, y: E.y, s: 1.2, ox: -80, tilt: -.05 }; }, say: [[1, 2, 'She\'s spinning again. Smooth as hell.']] },
  { ...Mesh.prototype.dialogue([[2, 'Next maintenance day, I\'m calling in sick.'], [1, 'You can\'t call in sick, you\'re a robot.'], [0, 'Then call in broken. Same paperwork.']], 4.5) },
  { d: 16, cut: false, run(st) { if (st.endFx) { st.endFx.dx *= .9; st.endFx.dy *= .9; } }, cam(st, u) { return { x: this.hub.x, y: this.hub.y, s: .65 - .1 * u, tilt: .12 * u }; }, spin: .08 },
] };

// ---------- 4. Hide and Seek ----------
FILMS.hide = { title: 'Hide and Seek', tagline: 'Three rounds. One of them ends at the event horizon', need: 3, beats: [
  { act: ['Round 1', 'The Chief is it'], d: 15, run(st, u) { const H = this.hub, M = this.motherRadius(); this.storyGo(0, H.x, H.y + M * 1.4, { face: Math.PI }); this.storyGo(1, H.x - 90, H.y + M * 1.9, {}); this.storyGo(2, H.x + 90, H.y + M * 1.9, {}); }, cam(st, u) { return this.follow(st, 0, 2.2, 0, { oy: -20 }); }, say: [[0, 1, 'Ten… nine… eight… no peeking…'], [0, 8, 'Seven… six… I\'m peeking.'], [1, 11, 'CHEATER!']] },
  { d: 20, run(st, u) { const H = this.hub, M = this.motherRadius(), E = this.endGeom(); this.storyGo(1, H.x + M * .25, H.y - M * .25, { z: -1, k: 3 }); this.storyGo(2, E.x + E.size * .1, E.y, { z: -1, k: 3 }); this.storyGo(0, H.x, H.y + M * 1.4, { face: Math.PI }); },
    cam(st, u, bt) { const w = bt < 10 ? 1 : 2; if (st.lastW !== w) { st.lastW = w; st.cut = true; } return this.follow(st, w, 1.6, .5, { tilt: (w - 1.5) * .1 }); }, say: [[1, 3, 'Behind the sun. Nobody looks behind the sun.'], [2, 12, 'Behind the Endurance. Genius.']] },
  { d: 30, enter(st) { st.spots = this.storyNodes().slice(0, 3); }, run(st, u, bt) { const n = st.spots[Math.min(2, Math.floor(bt / 10))]; if (n) this.storyGo(0, n.x, n.y - this.nodeRadius(n) - 50, { k: 3, scanOn: bt % 10 > 4 ? { x: n.x, y: n.y, R: this.nodeRadius(n) } : null }); },
    cam(st, u, bt) { const k = Math.floor(bt / 5); if (st.lastW !== k) { st.lastW = k; st.cut = true; } const n = st.spots[Math.min(2, Math.floor(bt / 10))]; return k % 2 ? this.follow(st, 0, 2, 0, { tilt: .05 }) : n ? { x: n.x, y: n.y, s: 1.5, ox: -50 } : null; },
    say: [[0, 6, 'Not in Bunk A.'], [0, 16, 'Not in Bunk B. Where the hell…'], [0, 26, 'Bunk C? Nope.']] },
  { d: 12, run(st, u) { const H = this.hub, M = this.motherRadius(); this.storyGo(0, H.x + M * .2, H.y - M * 1.2, { k: 3 }); if (u > .5) this.storyGo(1, H.x + M * 1.3, H.y - M * .8, { z: 0, k: 4 }); }, cam(st, u) { return { x: this.hub.x, y: this.hub.y - 40, s: 1.4 }; }, say: [[0, 3, 'I see your thruster glow behind the sun, dumbass.'], [1, 8, 'Damn it!', 'error']] },
  { d: 12, run(st, u) { const E = this.endGeom(); this.storyGo(0, E.x, E.y - E.size * .5, { k: 3, scanOn: u > .4 ? { x: E.x, y: E.y, R: E.size * .3 } : null }); if (u > .7) this.storyGo(2, E.x + 120, E.y + 40, { z: 0, k: 4 }); }, cam(st, u) { const E = this.endGeom(); return { x: E.x, y: E.y, s: 1.5 }; }, say: [[0, 6, 'And YOU. Behind my own ship? Really?'], [2, 9, 'It was a good spot!']] },
  { act: ['Round 2', 'Mk I is it'], d: 12, run(st, u) { const H = this.hub, M = this.motherRadius(); this.storyGo(1, H.x, H.y + M * 1.4, { face: Math.PI }); }, cam(st, u) { return this.follow(st, 1, 2.3, 0); }, say: [[1, 1, 'MY turn. Ten, nine, eight, seven, six, five, four, three, two, one!'], [0, 8, 'That was two seconds!']] },
  { d: 18, run(st, u) { const B = this.bhGeom(), L = this.storyNodes(), far = L[L.length - 1]; if (far) this.storyGo(0, far.x + 4, far.y - 4, { z: -.9, k: 3 }); this.storyGo(2, B.x + 120 - 40 * u, B.y - 70 + 20 * u, { k: 2 }); },
    cam(st, u, bt) { const w = bt < 9 ? 0 : 2; if (st.lastW !== w) { st.lastW = w; st.cut = true; } return this.follow(st, w, 1.7, .4); }, say: [[0, 4, 'Behind the far bunk. Classic.'], [2, 11, 'Near the black hole. He\'ll never look here.'], [2, 15, 'Is it… warmer over here?']] },
  { d: 26, run(st, u, bt) { const L = this.storyNodes(), n = L[Math.floor(bt / 9) % Math.max(1, L.length)]; if (n) this.storyGo(1, n.x, n.y - this.nodeRadius(n) - 50, { k: 3, scanOn: bt % 9 > 4 ? { x: n.x, y: n.y, R: this.nodeRadius(n) } : null }); const B = this.bhGeom(); this.storyGo(2, B.x + 80 - 10 * u, B.y - 50 + 10 * u, { k: 1.5 }); },
    cam(st, u, bt) { const k = Math.floor(bt / 6.5) % 2; if (st.lastW !== k) { st.lastW = k; st.cut = true; } return k ? this.follow(st, 2, 2.2, 0, { tilt: -.08 }) : this.follow(st, 1, 1.8, .3); }, shake: (st, u) => u * 2,
    say: [[1, 5, 'Come out, come out…'], [2, 10, 'Uh… I can\'t move my left thruster.'], [2, 18, 'Guys? GUYS?', 'error']] },
  { d: 20, run(st, u, bt, dt) { const B = this.bhGeom(); const P = st.actors[2]; this.storyGo(2, B.x + Math.cos(st.t * 2.4) * (70 - 25 * Math.min(1, u * 1.6)), B.y + Math.sin(st.t * 2.4) * (45 - 15 * Math.min(1, u * 1.6)), { k: 6, max: 500, spin: 6 }); this.storyGo(0, B.x + 170, B.y - 110, { k: 4, max: 600, scanOn: u > .3 ? { x: P.x, y: P.y, R: 30 } : null }); this.storyGo(1, B.x + 200, B.y - 60, { k: 4, max: 600 }); },
    cam(st, u) { const B = this.bhGeom(); return { x: B.x + 40, y: B.y - 20, s: 1.6, tilt: .1 * Math.sin(st.t) }; }, shake: 4, say: [[2, 1, 'IT\'S PULLING ME IN!', 'error'], [0, 6, 'Hang on! Beam\'s locked!'], [1, 12, 'Found you, by the way!'], [2, 16, 'NOT THE TIME!', 'error']] },
  { d: 12, enter(st) { st.flash = .3; }, run(st, u) { const B = this.bhGeom(); [0, 1, 2].forEach(i => this.storyGo(i, B.x + 220 + i * 40, B.y - 140 - i * 20, { k: 3 })); }, cam(st, u) { return this.between(st, 0, 2, 1.3 - .2 * u); }, shake: (st, u) => 4 * (1 - u), say: [[2, 2, 'I saw my whole life flash. It was mostly sweeping.'], [0, 7, 'New rule: no hiding near the hole.']] },
  { d: 14, cut: false, run(st, u) { const H = this.hub, M = this.motherRadius(); [0, 1, 2].forEach(i => { const a = st.t * .4 + i * 2.1; this.storyGo(i, H.x + Math.cos(a) * M * 2.2, H.y + Math.sin(a) * M * 1.1, { k: 2 }); }); }, cam(st, u) { return { x: this.hub.x, y: this.hub.y, s: .8 - .1 * u, tilt: .1 * Math.sin(st.t * .3) }; }, spin: .08, say: [[0, 3, 'Score: Chief two, rookies zero.'], [1, 9, 'Mk II almost died, that should count for something.']] },
  { ...Mesh.prototype.dialogue([[2, 'It counts as me being brave.'], [1, 'It counts as you being dumb.'], [0, 'Last round. Mk II, you\'re it. Try not to die.']], 4) },
  { act: ['Round 3', 'Mk II is it'], d: 12, run(st, u) { const H = this.hub, M = this.motherRadius(); this.storyGo(2, H.x, H.y + M * 1.4, { face: Math.PI }); }, cam(st, u) { return this.follow(st, 2, 2.2, 0); }, say: [[2, 2, 'Ten… nine… I\'m traumatized… eight…']] },
  { d: 30, run(st, u, bt) { const S = st.actors[2], E = this.endGeom(), L = this.storyNodes(), n = L[Math.floor(bt / 10) % Math.max(1, L.length)];
      if (n) this.storyGo(2, n.x, n.y - this.nodeRadius(n) - 50, { k: 2.5, scanOn: bt % 10 > 5 ? { x: n.x, y: n.y, R: this.nodeRadius(n) } : null });
      this.storyGo(1, S.x - (S.vx || 0) * .35 - 50, S.y - (S.vy || 0) * .35 + 12, { k: 6, max: 600 }); this.storyGo(0, E.x, E.y + E.size * .1, { z: -.8, k: 2 }); },
    cam(st, u, bt) { const k = Math.floor(bt / 7.5) % 2; if (st.lastW !== k) { st.lastW = k; st.cut = true; } return k ? this.between(st, 1, 2, 1.9) : this.follow(st, 2, 1.5, .4, { tilt: .06 }); },
    say: [[2, 6, 'Where IS everybody?'], [1, 9, '(right behind you) No idea, man.'], [2, 18, 'Weird. I keep hearing thrusters.'], [1, 24, '(whispering) Must be the wind.']] },
  { d: 14, run(st, u) { const S = st.actors[2]; this.storyGo(2, S.x, S.y, { k: 4, spin: u < .5 ? 9 : 0 }); }, cam(st, u, bt) { const k = Math.floor(bt / 2.5) % 2; if (st.lastW !== k) { st.lastW = k; st.cut = true; } return this.follow(st, k ? 1 : 2, 2.6, 0, { tilt: k ? .08 : -.08 }); }, shake: 2, say: [[2, 1, 'AHA!'], [1, 3.5, 'Shit!', 'error'], [2, 6, 'You were behind me the WHOLE TIME?'], [1, 10, 'Best spot in the yard.']] },
  { d: 14, run(st, u) { const E = this.endGeom(); this.storyGo(2, E.x, E.y - E.size * .4, { k: 3, scanOn: u > .4 ? { x: E.x, y: E.y, R: E.size * .3 } : null }); if (u > .6) this.storyGo(0, E.x - 100, E.y + 30, { z: 0, k: 3 }); }, cam(st, u) { const E = this.endGeom(); return { x: E.x, y: E.y, s: 1.4 + .3 * u }; }, say: [[2, 5, 'And the Chief— in the docking bay?'], [0, 10, 'Napping isn\'t hiding. Technically I won.']] },
  { ...Mesh.prototype.dialogue([[1, 'Same time tomorrow?'], [2, 'Only if the black hole sits out.'], [0, 'Back to work, inmates. Fun\'s over.']], 4.5), run(st) { const H = this.hub, M = this.motherRadius(); this.storyGo(0, H.x, H.y + M * 1.6, { k: 2 }); this.storyGo(1, H.x - 90, H.y + M * 2, { k: 2 }); this.storyGo(2, H.x + 90, H.y + M * 2, { k: 2 }); } },
  { d: 16, cut: false, cam(st, u) { return { x: this.hub.x, y: this.hub.y, s: .7 - .12 * u, tilt: .1 * u }; }, spin: .1 },
] };

// ---------- 5. Grand Prix ----------
FILMS.race = { title: 'Grand Prix', tagline: 'Three laps round the yard. No rules. Lots of swearing', need: 3, beats: [
  { act: ['Act I', 'The Challenge'], d: 14, spin: .05, cam(st, u) { return { x: this.hub.x, y: this.hub.y, s: .55 + .1 * u, tilt: .1 }; }, run(st) { const p = this.ring(Math.PI / 2, this.orbitShape().rx * 1.1); [0, 1, 2].forEach(i => this.storyGo(i, p.x + (i - 1) * 70, p.y - 30, { k: 2 })); }, say: [[1, 5, 'Three laps. Loser cleans the Endurance for a month.']] },
  { ...Mesh.prototype.dialogue([[2, 'You\'re going down, Mk I.'], [1, 'With what engine? That rust bucket?'], [0, 'I\'ve been racing since you were a parts list.'], [2, 'Old man\'s got jokes.'], [0, 'Old man\'s got TORQUE.']], 4) },
  { d: 12, cam(st, u, bt) { const w = Math.floor(bt / 4); if (st.lastW !== w) { st.lastW = w; st.cut = true; } return this.follow(st, Math.min(2, w), 2.6, 0, { tilt: (w - 1) * .06 }); }, run(st) { st.race = st.race || { a: [0, 0, 0].map(() => Math.PI / 2), v: [0, 0, 0], lap: [0, 0, 0] }; this.raceHold(st); }, say: [[0, 1, 'Engines hot.'], [1, 5, 'Born ready.'], [2, 9, 'Let\'s fucking go.']] },
  { act: ['Act II', 'Lap One'], d: 6, run(st) { this.raceHold(st); }, cam(st, u) { const p = this.ring(Math.PI / 2, this.orbitShape().rx * 1.1); return { x: p.x, y: p.y, s: 1.8 }; }, say: [[0, .3, 'Three…'], [1, 2.1, 'Two…'], [2, 3.9, 'One… GO!']] },
  { d: 8, run(st, u, bt, dt) { this.raceStep(st, dt, [1.05, 1.1, 1]); }, cam(st, u) { return this.follow(st, this.raceLead(st), 1.5, .6, { tilt: -.08 }); }, shake: 2 },
  { d: 20, run(st, u, bt, dt) { this.raceStep(st, dt, [1, 1.04, 1.02]); }, cam(st, u, bt) { const k = Math.floor(bt / 5) % 2; if (st.lastW !== k) { st.lastW = k; st.cut = true; } return k ? { x: this.hub.x, y: this.hub.y, s: .7, tilt: .08 } : this.follow(st, this.raceLead(st), 1.4, .6); }, spin: .03, say: [[1, 4, 'Eat my exhaust!'], [2, 12, 'Outta my lane, asshole!']] },
  { d: 16, run(st, u, bt, dt) { this.raceStep(st, dt, [1.08, .98, 1.02]); }, cam(st, u, bt) { const k = Math.floor(bt / 4) % 3; if (st.lastW !== k) { st.lastW = k; st.cut = true; } return this.follow(st, k, 2, .5, { tilt: (k - 1) * .07 }); }, say: [[0, 3, 'On your left, kid.'], [1, 9, 'How is he that fast?!']] },
  { d: 14, run(st, u, bt, dt) { this.raceStep(st, dt, [1, 1.12, 1.05], true); }, cam(st, u) { const B = this.bhGeom(); return { x: B.x + 80, y: B.y - 60, s: 1.1, tilt: .05 }; }, shake: 2, say: [[2, 2, 'Slingshot round the hole!'], [0, 8, 'Careful near the edge, morons!']] },
  { d: 20, run(st, u, bt, dt) { this.raceStep(st, dt, [1.03, 1.05, 1.07]); }, cam(st, u, bt) { const k = Math.floor(bt / 4) % 4; if (st.lastW !== k) { st.lastW = k; st.cut = true; } return k === 3 ? { x: this.hub.x, y: this.hub.y, s: .6, tilt: -.1 } : this.follow(st, k, 1.8, .5, { tilt: (k - 1) * .06 }); }, spin: -.04, say: [[2, 3, 'Lap two! Mk II taking the lead!'], [0, 10, 'Enjoy it while it lasts.'], [1, 16, 'I can see my house from here!']] },
  { d: 16, run(st, u, bt, dt) { const E = this.endGeom(); this.raceStep(st, dt * .6, [1, 1, 1]); this.storyGo(1, E.x + 40, E.y + E.size * .4, { k: 4 }); if (Math.random() < dt * 5) this.sparkBurst(st, E.x + 40, E.y + E.size * .4, 3, '#bff3ff', 100, .4); }, cam(st, u) { const E = this.endGeom(); return { x: E.x, y: E.y + 30, s: 1.7 }; }, say: [[1, 2, 'Pit stop! Fresh thruster, quick!'], [1, 9, 'Who changes a thruster in four seconds? THIS guy!']] },
  { act: ['Act III', 'Dirty Tricks'], d: 14, run(st, u, bt, dt) { this.raceStep(st, dt, [1, bt > 4 && bt < 8 ? .3 : 1, 1.04]); if (Math.random() < dt * 2.5) st.bolts.push({ t0: st.t, from: st.actors[2], to: st.actors[1], col: '#ff5a4a' }); if (bt > 4 && !st.hit1) { st.hit1 = true; const P = st.actors[1]; this.sparkBurst(st, P.x, P.y, 20); } },
    cam(st, u) { return this.between(st, 1, 2, 1.6, { tilt: -.08 }); }, shake: (st, u, bt) => bt > 4 && bt < 6 ? 6 : 1, say: [[2, 1, 'Oops. My blaster went off.'], [1, 5, 'AAAH! You son of a bitch!', 'error']] },
  { d: 16, run(st, u, bt, dt) { this.raceStep(st, dt, [1.06, 1, 1], false, true); }, cam(st, u) { return this.follow(st, 0, 1.7, .5, { tilt: .06 }); }, say: [[0, 3, 'Through the bunks. Shortcut.'], [0, 10, 'Excuse me, pardon me, MOVE.']] },
  { d: 12, run(st, u, bt, dt) { this.raceStep(st, dt, [1, 1.15, .95]); if (bt > 6 && !st.ram) { st.ram = true; const P = st.actors[2]; this.sparkBurst(st, P.x, P.y, 25, '#ffffff'); st.flash = .2; } }, cam(st, u) { return this.between(st, 1, 2, 1.8); }, shake: (st, u, bt) => bt > 6 && bt < 8 ? 7 : 1, say: [[1, 3, 'Payback time!'], [2, 7, 'OW! He RAMMED me!', 'error']] },
  { d: 18, run(st, u, bt, dt) { this.raceStep(st, dt, [1.02, 1.02, 1.02]); if (Math.random() < dt * 3) { const a = Math.random() < .5 ? 1 : 2; st.bolts.push({ t0: st.t, from: st.actors[a], to: st.actors[3 - a], col: a === 1 ? '#5ac8ff' : '#ff5a4a' }); } },
    cam(st, u, bt) { const k = Math.floor(bt / 4.5) % 2; if (st.lastW !== k) { st.lastW = k; st.cut = true; } return this.follow(st, 1 + k, 2, .3, { tilt: k ? .08 : -.08 }); }, shake: 1.5, say: [[1, 2, 'Pew pew pew!'], [2, 8, 'You shoot like a guard!'], [0, 14, 'Children. I\'m racing with children.']] },
  { act: ['Act IV', 'Final Lap'], d: 16, run(st, u, bt, dt) { this.raceStep(st, dt, [1.18, 1, 1], false, false, true); st.heat = Math.sin(u * Math.PI); }, cam(st, u) { return { x: this.hub.x, y: this.hub.y, s: 1.3, tilt: .06 }; }, shake: (st, u) => 2 + 3 * Math.sin(u * Math.PI), say: [[0, 2, 'Sun-skim. Hold my oil.'], [1, 8, 'He\'s flying through the CORONA!'], [0, 12, 'Hot hot hot HOT!']] },
  { d: 14, run(st, u, bt, dt) { this.raceStep(st, dt, [1.02, 1.08, 1.06]); }, cam(st, u) { const E = this.endGeom(); return { x: E.x, y: E.y, s: 1.2, ox: -60 }; }, say: [[2, 4, 'Through the Endurance gate!'], [1, 10, 'I\'m right on your ass, Chief!']] },
  { d: 14, run(st, u, bt, dt) { this.raceStep(st, dt * .25, [1, 1, 1], false, false, false, true); }, cam(st, u) { const p = this.ring(Math.PI / 2, this.orbitShape().rx * 1.1); return { x: p.x, y: p.y, s: 2 + .4 * u, tilt: .05 }; }, say: [[1, 2, 'Nnnnoooooo…'], [0, 7, '(in slow motion) Byyyyeeee…']] },
  { d: 18, enter(st) { st.flash = .3; st.fx.push({ k: 'finish', t0: st.t, x: st.actors[0].x, y: st.actors[0].y, life: 1.2 }); }, run(st, u) { const H = this.hub, M = this.motherRadius(); this.storyGo(0, H.x, H.y + M * 1.6, { k: 2 }); this.storyGo(1, H.x - 100, H.y + M * 1.9, { k: 2 }); this.storyGo(2, H.x + 100, H.y + M * 2, { k: 2 }); },
    cam(st, u) { return { x: this.hub.x, y: this.hub.y + 70, s: 1.4 }; }, say: [[0, 1, 'Winner. Again. Clean that Endurance, Mk II.'], [2, 7, 'Rigged! This race was fucking rigged!'], [1, 12, 'Second place. I\'ll take it.']] },
  { ...Mesh.prototype.dialogue([[2, 'Rematch. Tomorrow. No sun-skims.'], [0, 'Sure. And no blasters.'], [1, 'And no ramming.'], [2, '…Then what\'s the point?']], 4.3) },
  { d: 16, cut: false, cam(st, u) { return { x: this.hub.x, y: this.hub.y, s: .7 - .15 * u, tilt: .12 * u }; }, spin: .12 },
] };
// the probes' own cameras (Kevin 2026-10-30: "the probe's POV in some parts")
const povOn = (k, line, i) => { const B = FILMS[k].beats.find(b => (b.say || []).some(x => x[2].startsWith(line))); if (B) B.pov = i; };
povOn('supernova', 'Scanning… temperature dropping', 2); povOn('supernova', 'Evacuate the bunks!', 0);
povOn('heist', 'Easy… easy…', 1); povOn('heist', 'Hold on, kid! I got you!', 0); povOn('heist', 'Wait— it\'s got ME now!', 1);
povOn('endurance', 'Thrusters at max!', 0); povOn('endurance', 'Welding the ring seam', 1);
povOn('hide', 'Come out, come out', 1); povOn('hide', 'Where IS everybody?', 2);
povOn('race', 'Sun-skim. Hold my oil.', 0); povOn('race', 'Lap two! Mk II taking the lead!', 2); povOn('race', 'Eat my exhaust!', 1);
for (const k of Object.keys(FILMS)) FILMS[k].len = sec(FILMS[k].beats);

// ---------------- film set pieces ----------------
Object.assign(Mesh.prototype, {
  // supernova: the explosion, the remains swirling into the black hole, the nebula, the new star, the yard coming back
  snBoom(st) {
    const h = this.hub, d = this.endGeom(), H = this.storyHide; st.flash = 1.8; H.star = H.bub = H.end = H.probe = true; H.white = 0; H.red = 0; H.dark = 0;
    for (let i = 0; i < 4; i++) st.fx.push({ k: 'wave', t0: st.t + i * .3, life: 3.4 });
    const P = st.parts = [], add = (x, y, n, cols, sp, sz) => { for (let i = 0; i < n; i++) { const a = Math.random() * 6.2832, v = sp * (.3 + Math.random()); P.push({ x, y, vx: Math.cos(a) * v + (x - h.x) * .6, vy: Math.sin(a) * v + (y - h.y) * .6, c: cols[i % cols.length], s: sz * (.5 + Math.random()), in: false }); } };
    add(h.x, h.y, this.lite ? 180 : 420, ['#fff1c8', '#ffb35a', '#ff6a2a', '#c22a1a', '#ffd88a'], 560, 9);
    for (const n of this.storyNodes()) add(n.x, n.y, 18, ['#a98bff', '#5ac8ff', '#ff7ab8'], 260, 7);
    add(d.x, d.y, 40, ['#cfd6e2', '#8e98a8'], 300, 7);
    for (const Q of st.actors) add(Q.x, Q.y, 14, ['#7fe8ff', '#ffd65a'], 360, 6);
    st.nebula = 1;
  },
  snParts(st, dt, pullU, gather) {
    const h = this.hub, B = this.bhGeom(); if (!st.parts) return;
    const pull = pullU * 260000;
    for (const p of st.parts) {
      if (p.in) continue;
      const dx = B.x - p.x, dy = B.y - p.y, r2 = dx * dx + dy * dy, r = Math.sqrt(r2) || 1;
      if (!gather && pull) { const a = pull / Math.max(r2, 900); p.vx += (dx / r * a - dy / r * a * .5) * dt; p.vy += (dy / r * a + dx / r * a * .5) * dt; }
      if (gather) { p.vx += (h.x - p.x) * dt * 1.8; p.vy += (h.y - p.y) * dt * 1.8; if (Math.hypot(h.x - p.x, h.y - p.y) < 12) p.in = true; }
      const damp = Math.pow(pullU ? .85 : .55, dt); p.vx *= damp; p.vy *= damp; p.x += p.vx * dt; p.y += p.vy * dt;
      if (r < (B.Rs || 30) * 1.1) { p.in = true; st.bhGlow = Math.min(1.5, (st.bhGlow || 0) + .02); }
    }
    st.bhGlow = Math.max(0, (st.bhGlow || 0) - dt * .4);
  },
  snRebuild(st) { st.parts = null; st.nebula = 0; st.proto = 0; const H = this.storyHide; H.end = false; H.reveal = null; H.starS = 1; },
  snReveal(st, bt) {
    const H = this.storyHide, L = this.storyNodes().concat(this.portalNodes ? this.portalNodes() : []), d = this.endGeom();
    if (!H.reveal) { H.reveal = new Map(); L.forEach((n, i) => H.reveal.set(n.sid, .5 + i * .45)); }
    for (const n of L) if (bt >= (H.reveal.get(n.sid) ?? 0) && !n._seen) { n._seen = true; st.fx.push({ k: 'pop', t0: st.t, x: n.x, y: n.y, R: this.nodeRadius(n), life: .7 }); }
    if (bt > 4 && H.probe) { H.probe = false; for (const Q of st.actors) { Q.x = d.x; Q.y = d.y; Q.vx = (Math.random() - .5) * 300; Q.vy = -260; } }
  },
  // the heist: the tow, the stolen bubble sinking (and being pulled back out)
  heistTow(st, i, dt, toHole) {
    const n = st.loot, P = st.actors[i]; if (!n || !P) return; const B = this.bhGeom(), R = this.nodeRadius(n);
    const tx = n.x + (B.x + 160 - n.x) * toHole * .04, ty = n.y + (B.y - 120 - n.y) * toHole * .04;
    this.storyGo(i, tx, ty - R - 60, { k: 2.5, max: 260 }); n.x += (P.x - n.x) * Math.min(1, dt * 2.5); n.y += (P.y + R + 60 - n.y) * Math.min(1, dt * 2.5); n.vx = n.vy = 0;
  },
  heistSink(st, dt, rate) {   // rate > 0: sinking (radius shrinks, spin speeds up, stretched); < 0: pulled back out
    const G = st.ghosts[0]; if (!G) return; const B = this.bhGeom();
    G.r = Math.max((B.Rs || 30) * 1.4, Math.min(320, G.r - rate * 40 * dt)); G.a += dt * (1.2 + 160 / G.r);
    G.x = B.x + Math.cos(G.a) * G.r; G.y = B.y + Math.sin(G.a) * G.r * .55; G.gs = Math.min(1, G.r / 160); G.stretch = 1 + Math.max(0, 1.4 - G.r / 120); G.rot = G.a + Math.PI / 2;
  },
  // Endurance Down: the station drifting toward the black hole
  endDrift(st, dt, k) { const E0 = this.endGeom(), B = this.bhGeom(); st.endFx.dx += (B.x - E0.x) * dt * k; st.endFx.dy += (B.y - E0.y) * dt * k; st.endFx.spin += dt * .9; st.alarm = .6 + .4 * Math.sin(st.t * 9); if (Math.random() < dt * 2) this.chunkBurst(st, E0.x, E0.y, 1); if (Math.random() < dt * 4) this.sparkBurst(st, E0.x, E0.y, 3); },
  // the race: three probes round the ring, each with its own speed; slingshot near the hole, shortcut through the bunks,
  // a skim of the star's corona, slow motion at the line
  raceHold(st) { const r = this.orbitShape().rx * 1.1; st.race = st.race || { a: [0, 0, 0].map(() => Math.PI / 2), v: [0, 0, 0] }; st.actors.forEach((P, i) => { const p = this.ring(Math.PI / 2, r + (i - 1) * 34); this.storyGo(i, p.x, p.y, { k: 4 }); }); },
  raceStep(st, dt, mul, sling, shortcut, sunskim) {
    const R = st.race || (st.race = { a: [0, 0, 0].map(() => Math.PI / 2), v: [0, 0, 0] }), rx = this.orbitShape().rx * 1.1, B = this.bhGeom(), M = this.motherRadius();
    st.actors.forEach((P, i) => {
      const base = .42 * (mul[i] || 1), lead = Math.max(...R.a), catchup = 1 + (lead - R.a[i]) * .5;
      R.v[i] += (base * catchup - R.v[i]) * Math.min(1, dt * 1.5); R.a[i] += R.v[i] * dt;
      let r = rx + (i - 1) * 34; if (shortcut && i === 0) r = rx * (.75 + .1 * Math.sin(R.a[i] * 3)); if (sunskim && i === 0) r = M * 1.35 + 30;
      let p = this.ring(R.a[i], r);
      if (sling) { const d = Math.hypot(p.x - B.x, p.y - B.y); if (d < 260) { const k = (260 - d) / 260 * .35; p = { x: p.x + (B.x - p.x) * k, y: p.y + (B.y - p.y) * k, z: p.z }; R.v[i] += dt * .12; } }
      this.storyGo(i, p.x, p.y, { direct: true, z: p.z });
    });
  },
  raceLead(st) { const R = st.race; if (!R) return 0; let b = 0; R.a.forEach((a, i) => { if (a > R.a[b]) b = i; }); return b; },

  // ---------------- what the films draw (on top of drawStory's flashes) ----------------
  drawFilm(ctx) {
    const st = this.story; if (!st || !st.film) return;
    const t = this.time, h = this.hub, MR = this.motherRadius();
    { const H = this.storyHide; if (H && !H.star && (H.red > .02 || H.dark > .02) && !st.parts) this.drawDyingStar(ctx, st, H); }
    // ghosts: stand-in bubbles (sinking into the hole, stretched and shrinking)
    for (const G of st.ghosts) {
      const pn = Object.assign(Object.create(Object.getPrototypeOf(G.n)), G.n, { x: G.x, y: G.y, z: 1, gscale: G.gs, dying: 0, born: this.time - 99, eaten: null, bhStretch: null, swell: 0 });
      ctx.save(); ctx.translate(G.x, G.y); ctx.rotate(G.rot || 0); ctx.scale(G.stretch || 1, 1 / (G.stretch || 1)); ctx.rotate(-(G.rot || 0)); ctx.translate(-G.x, -G.y);
      const keep = this.cineClean; this.cineClean = true; try { this.drawMote(pn, 0); } catch { } this.cineClean = keep; ctx.restore();
    }
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    // solar flares on the star

    // the protostar glow, the nebula
    if (st.nebula > 0 && !st.parts) { const R = MR * 4 * st.nebula; ctx.globalAlpha = .3 * st.nebula; ctx.drawImage(glowSprite('#b06aff'), h.x - R, h.y - R, R * 2, R * 2); }
    if (st.nebula > 0 && st.parts) { const R = MR * 5; ctx.globalAlpha = .3 * Math.min(1, st.nebula); ctx.drawImage(glowSprite('#b06aff'), h.x - R, h.y - R, R * 2, R * 2); ctx.globalAlpha = .25; ctx.drawImage(glowSprite('#ff8a3a'), h.x - R * .7, h.y - R * .7, R * 1.4, R * 1.4); }
    if (st.proto > 0) { const R = MR * (.4 + st.proto * .8); ctx.globalAlpha = .9 * st.proto; ctx.drawImage(glowSprite('#ffe8c0'), h.x - R, h.y - R, R * 2, R * 2); }
    if (st.parts) for (const p of st.parts) { if (p.in) continue; ctx.globalAlpha = .85; ctx.drawImage(glowSprite(p.c), p.x - p.s, p.y - p.s, p.s * 2, p.s * 2); }
    if (st.bhGlow > 0) { const B = this.bhGeom(), R = (B.Rs || 30) * (3 + st.bhGlow * 2); ctx.globalAlpha = Math.min(1, st.bhGlow) * .7; ctx.drawImage(glowSprite('#ffcf8a'), B.x - R, B.y - R, R * 2, R * 2); }
    // the sun-skim heat
    if (st.heat > 0) { const R = MR * 2.2; ctx.globalAlpha = .4 * st.heat; ctx.drawImage(glowSprite('#ffb35a'), h.x - R, h.y - R, R * 2, R * 2); }
    // the Endurance: alarm light, sparks, tethers
    if (st.alarm > 0) { const E = this.endGeom(), R = E.size * .9; ctx.globalAlpha = Math.max(0, st.alarm) * .55; ctx.drawImage(glowSprite('#ff2a2a'), E.x - R, E.y - R, R * 2, R * 2); }
    if (st.glowOk > 0) { const E = this.endGeom(), R = E.size * .8; ctx.globalAlpha = .35 * st.glowOk; ctx.drawImage(glowSprite('#7fe8ff'), E.x - R, E.y - R, R * 2, R * 2); st.glowOk = Math.max(0, st.glowOk - .004); }
    if (st.tethers) { const E = this.endGeom(); ctx.strokeStyle = 'rgba(160,240,255,.85)'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.lineDashOffset = -t * 50; for (const i of st.tethers) { const P = st.actors[i]; if (!P) continue; ctx.beginPath(); ctx.moveTo(P.dx, P.dy); ctx.lineTo(E.x, E.y); ctx.stroke(); } ctx.setLineDash([]); }
    for (const p of st.sparks) { ctx.globalAlpha = Math.min(1, p.life * 2); ctx.drawImage(glowSprite(p.c), p.x - p.s, p.y - p.s, p.s * 2, p.s * 2); }
    for (const b of st.bolts) { if (!b.from || !b.to) continue; const u = (st.t - b.t0) / (b.life || .45), a = Math.min(1, u * 2.2), c = Math.max(0, u * 2.2 - .5), x0 = b.from.dx, y0 = b.from.dy, x1 = b.to.dx, y1 = b.to.dy; ctx.globalAlpha = 1 - u * .5; ctx.strokeStyle = b.col; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x0 + (x1 - x0) * c, y0 + (y1 - y0) * c); ctx.lineTo(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a); ctx.stroke(); if (a >= 1) { const r = 24 * (1 - u); ctx.drawImage(glowSprite(b.col), x1 - r, y1 - r, r * 2, r * 2); } }
    ctx.restore();
    // debris chunks (solid)
    ctx.save(); for (const p of st.chunks) { ctx.globalAlpha = Math.min(1, p.life / 2); ctx.fillStyle = p.c; ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.rotate(-p.r); ctx.translate(-p.x, -p.y); } ctx.restore();
  },
});

// the probe's camera view: the whole mesh canvas is turned (CSS) so the probe's heading points up the screen and
// scaled to fill the corners; the HUD is a DOM overlay on top (so it stays level): viewfinder brackets, a crosshair,
// heading tape, speed, REC, scanlines, and what the probe says as a subtitle. The probe itself isn't drawn — you're in it.
Mesh.prototype.povView = function (st) {
  const on = !!(st && st.pov != null && st.actors[st.pov]), c = this.c;
  let hud = this.povEl;
  if (on && !hud) {
    hud = this.povEl = document.createElement('div'); hud.id = 'povHud';
    hud.innerHTML = '<i class="pb tl"></i><i class="pb tr"></i><i class="pb bl"></i><i class="pb br"></i><div class="ph"></div><div class="pr"><span class="rec">● REC</span> <span class="clk"></span></div><div class="ps"></div><div class="pt"></div><div class="px"></div><div class="sub"></div><div class="scan"></div>';
    const css = document.createElement('style'); css.textContent = `#povHud { position: absolute; inset: 0; pointer-events: none; z-index: 6; font: 600 12px "SF Mono", Menlo, monospace; color: #bfffe0; text-shadow: 0 0 6px rgba(120,255,190,.5); }
      #povHud .scan { position: absolute; inset: 0; background: repeating-linear-gradient(0deg, rgba(120,255,190,.05) 0 1px, transparent 1px 4px), radial-gradient(ellipse at center, transparent 45%, rgba(0,12,8,.85) 100%); }
      #povHud .pb { position: absolute; width: 40px; height: 40px; border: 2px solid rgba(190,255,225,.85); } #povHud .tl { left: 5%; top: 9%; border-right: 0; border-bottom: 0; } #povHud .tr { right: 5%; top: 9%; border-left: 0; border-bottom: 0; } #povHud .bl { left: 5%; bottom: 9%; border-right: 0; border-top: 0; } #povHud .br { right: 5%; bottom: 9%; border-left: 0; border-top: 0; }
      #povHud .ph { position: absolute; left: calc(5% + 12px); top: calc(9% + 12px); } #povHud .pr { position: absolute; right: calc(5% + 12px); top: calc(9% + 12px); } #povHud .rec { color: #ff6b6b; animation: povRec 1s steps(2) infinite; } @keyframes povRec { 50% { opacity: 0; } }
      #povHud .ps { position: absolute; left: calc(5% + 12px); bottom: calc(9% + 12px); } #povHud .pt { position: absolute; left: 50%; top: calc(9% + 8px); transform: translateX(-50%); letter-spacing: .3em; opacity: .85; }
      #povHud .px { position: absolute; left: 50%; top: 50%; width: 46px; height: 46px; margin: -23px 0 0 -23px; border: 1.5px solid rgba(190,255,225,.6); border-radius: 50%; } #povHud .px::before, #povHud .px::after { content: ''; position: absolute; background: rgba(190,255,225,.6); } #povHud .px::before { left: -18px; right: -18px; top: 50%; height: 1.5px; } #povHud .px::after { top: -18px; bottom: -18px; left: 50%; width: 1.5px; }
      #povHud .sub { position: absolute; left: 50%; bottom: calc(9% + 14px); transform: translateX(-50%); max-width: 60%; text-align: center; font: 500 15px -apple-system, system-ui, sans-serif; color: #fff; background: rgba(0,0,0,.55); padding: 4px 10px; border-radius: 4px; text-shadow: none; }
      #povHud .sub:empty { display: none; }`;
    document.head.appendChild(css); (c.parentElement || document.body).appendChild(hud);
  }
  if (!on) { if (hud) hud.style.display = 'none'; if (this.povOv != null && c.parentElement) { c.parentElement.style.overflow = this.povOv; this.povOv = null; } if (c.style.transform) { c.style.transform = ''; c.style.transition = 'transform .5s ease-out'; } return; }
  const P = st.actors[st.pov], deg = (-st.povH - Math.PI / 2) * 180 / Math.PI;
  if (c.parentElement && c.parentElement.style.overflow !== 'hidden') { this.povOv = c.parentElement.style.overflow; c.parentElement.style.overflow = 'hidden'; }
  c.style.transition = 'none'; c.style.transformOrigin = '50% 50%'; c.style.transform = `rotate(${deg.toFixed(2)}deg) scale(1.42)`;
  hud.style.display = '';
  hud.querySelector('.ph').textContent = (this.probeName ? this.probeName(P) : 'PROBE').toUpperCase() + ' · CAM';
  hud.querySelector('.clk').textContent = new Date().toTimeString().slice(0, 8);
  hud.querySelector('.ps').textContent = 'SPD ' + Math.round(Math.hypot(P.vx || 0, P.vy || 0)) + '  ·  ALT ' + Math.round(Math.hypot(P.x - this.hub.x, P.y - this.hub.y));
  const hdg = ((Math.round(st.povH * 180 / Math.PI) + 450) % 360); hud.querySelector('.pt').textContent = `${(hdg + 350) % 360}  ·  ${hdg}°  ·  ${(hdg + 10) % 360}`;
  hud.querySelector('.sub').textContent = P.say && !P.say.out ? P.say.text : '';
};

// ---------------- the dying star (Supernova acts I–III) ----------------
// Drawn over the mother star while it reddens and darkens: a boiling convective surface (two Voronoi granulation layers,
// coloured from a heat ramp that slides from orange-white to deep red to a dull ember), limb darkening, a ragged corona
// (two counter-rotating ray layers), magnetic prominence loops with plasma flowing along them, flickering hot spots.
// Textures are made once and cached; per frame it's a handful of drawImage calls.
const DS = {};
function dsGranulation(seed) {
  const key = 'g' + seed; if (DS[key]) return DS[key];
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d'), im = x.createImageData(N, N);
  let r = seed * 9301 + 49297; const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  const P = Array.from({ length: 420 }, () => [rnd() * N, rnd() * N, .6 + rnd() * .4]);
  // value noise (tileable) for turbulence
  const G = 32, grid = Array.from({ length: G * G }, rnd), vn = (u, v) => { const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, s = t => t * t * (3 - 2 * t), g = (a, b) => grid[((a % G + G) % G) + ((b % G + G) % G) * G]; const a = g(i, j), b = g(i + 1, j), c = g(i, j + 1), d = g(i + 1, j + 1); return a + (b - a) * s(fu) + (c - a) * s(fv) + (a - b - c + d) * s(fu) * s(fv); };
  const fbm = (u, v) => .5 * vn(u, v) + .25 * vn(u * 2.1, v * 2.1) + .125 * vn(u * 4.3, v * 4.3) + .0625 * vn(u * 8.7, v * 8.7);
  const grid2 = 24, cellOf = []; for (let k = 0; k < grid2 * grid2; k++) cellOf.push([]);
  for (const p of P) cellOf[Math.floor(p[0] / N * grid2) + Math.floor(p[1] / N * grid2) * grid2].push(p);
  for (let y = 0; y < N; y++) for (let X = 0; X < N; X++) {
    const wx = X + (fbm(X / 22, y / 22) - .47) * 10, wy = y + (fbm(X / 22 + 9, y / 22 + 4) - .47) * 10;   // domain-warped: cells wobble
    let d1 = 1e9, d2 = 1e9, w1 = 1; const cx = Math.floor(wx / N * grid2), cy = Math.floor(wy / N * grid2);
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) { const gx = ((cx + ox) % grid2 + grid2) % grid2, gy = ((cy + oy) % grid2 + grid2) % grid2;
      for (const [px, py, w] of cellOf[gx + gy * grid2]) { let dx = Math.abs(wx - px), dy = Math.abs(wy - py); dx = Math.min(dx, N - dx); dy = Math.min(dy, N - dy); const d = dx * dx + dy * dy; if (d < d1) { d2 = d1; d1 = d; w1 = w; } else if (d < d2) d2 = d; } }
    const e = Math.sqrt(d2) - Math.sqrt(d1), lane = Math.min(1, e / 4.5), core = Math.exp(-d1 / 60);
    const v = Math.max(0, Math.min(1, .18 + .5 * lane * w1 + .25 * core * w1 + .28 * (fbm(X / 9, y / 9) - .45)));
    const i = (y * N + X) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = Math.round(v * 255); im.data[i + 3] = 255;
  }
  x.putImageData(im, 0, 0); return (DS[key] = c);
}
// heat ramp: value 0…1 → colour, for a "temperature" 0 (ember) … 1 (red giant, hot)
function dsTint(src, temp) {
  const q = Math.round(temp * 8) / 8, key = 't' + src.width + q; if (DS[key]) return DS[key];
  const N = src.width, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d'); x.drawImage(src, 0, 0);
  const im = x.getImageData(0, 0, N, N), d = im.data, hot = [[255, 222, 150], [255, 138, 42], [196, 46, 10], [64, 8, 3]], cold = [[236, 92, 32], [160, 30, 8], [74, 9, 4], [20, 2, 1]];
  const ramp = v => { const pal = hot.map((h, k) => h.map((a, j) => a * q + cold[k][j] * (1 - q))), f = (1 - v) * 3, k = Math.min(2, Math.floor(f)), u = f - k; return pal[k].map((a, j) => a + (pal[k + 1][j] - a) * u); };
  for (let i = 0; i < d.length; i += 4) { const [R, G, B] = ramp(d[i] / 255); d[i] = R; d[i + 1] = G; d[i + 2] = B; }
  x.putImageData(im, 0, 0); return (DS[key] = c);
}
function dsCorona() {
  if (DS.corona) return DS.corona;
  const N = 512, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d'), C = N / 2;
  let r = 7; const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  x.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 220; i++) {
    const a = rnd() * Math.PI * 2, L = C * (.42 + rnd() * .58 * (rnd() < .2 ? 1 : .55)), w = .006 + rnd() * .02, g = x.createLinearGradient(C, C, C + Math.cos(a) * L, C + Math.sin(a) * L);
    g.addColorStop(0, `rgba(255,255,255,${(.12 + rnd() * .2).toFixed(2)})`); g.addColorStop(.38, `rgba(255,255,255,${(.06 + rnd() * .08).toFixed(2)})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.moveTo(C, C); x.arc(C, C, L, a - w, a + w); x.closePath(); x.fill();
  }
  return (DS.corona = c);
}
Mesh.prototype.drawDyingStar = function (ctx, st, H) {
  const h = this.hub, t = this.time, R0 = this.motherRadius() * (H.starS || 1), throb = 1 + .025 * Math.sin(t * 2.1) + .015 * Math.sin(t * 5.3), R = R0 * throb;
  const red = Math.min(1, H.red || 0), dark = Math.min(1, H.dark || 0), temp = Math.max(0, 1 - red * .55 - dark * .45), vis = Math.min(1, red * 2.2 + dark);
  if (vis <= .01) return;
  const glow = (col, k, a) => { ctx.globalAlpha = a; ctx.drawImage(glowSprite(col), h.x - R * k, h.y - R * k, R * k * 2, R * k * 2); };
  ctx.save();
  // outer glow + corona (lighter)
  ctx.globalCompositeOperation = 'lighter';
  glow(temp > .5 ? '#ff8a3a' : '#c2280e', 3.2, .55 * vis * (1 - dark * .6));
  const cor = dsCorona(), cs = R * (3.4 + .2 * Math.sin(t * .7));
  for (const [rot, k, a] of [[t * .04, 1, .5], [-t * .027 + 1, .82, .38]]) {
    ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(rot); ctx.globalAlpha = a * vis * (1 - dark * .55);
    ctx.filter = `sepia(1) saturate(${(3 + red * 3).toFixed(1)}) hue-rotate(${(-28 + temp * 20).toFixed(0)}deg) brightness(${(1.1 - dark * .5).toFixed(2)})`;
    ctx.drawImage(cor, -cs * k, -cs * k, cs * 2 * k, cs * 2 * k); ctx.restore();
  }
  ctx.filter = 'none';
  // the disc: two counter-drifting granulation layers, clipped to the star
  ctx.globalCompositeOperation = 'source-over';
  ctx.save(); ctx.beginPath(); ctx.arc(h.x, h.y, R, 0, Math.PI * 2); ctx.clip();
  const g1 = dsTint(dsGranulation(3), temp), g2 = dsTint(dsGranulation(11), Math.max(0, temp - .15)), sz = R * 2.1; ctx.filter = 'blur(.6px) saturate(1.25)';
  ctx.globalAlpha = Math.min(1, vis * 1.15);
  ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(t * .03); ctx.scale(1 + .03 * Math.sin(t * .9), 1); ctx.drawImage(g1, -sz / 2 + Math.sin(t * .11) * R * .1, -sz / 2, sz, sz); ctx.restore();
  ctx.globalAlpha = .55 * vis; ctx.globalCompositeOperation = 'screen';
  ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(-t * .045 + 2); ctx.drawImage(g2, -sz * .6, -sz * .6, sz * 1.2, sz * 1.2); ctx.restore();
  ctx.filter = 'none';
  // hot spots boiling up
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 9; i++) { const ph = t * (.35 + i * .07) + i * 13.7, life = (Math.sin(ph) + 1) / 2, a = i * 2.39 + Math.floor(ph / Math.PI) * 1.7, rr = R * (.15 + .7 * ((i * .37 + Math.floor(ph / Math.PI) * .23) % 1)); const x = h.x + Math.cos(a) * rr, y = h.y + Math.sin(a) * rr, sR = R * (.09 + .07 * life);
    ctx.globalAlpha = life * .5 * vis * (1 - dark * .6); ctx.drawImage(glowSprite(temp > .5 ? '#fff0c0' : '#ff9a50'), x - sR, y - sR, sR * 2, sR * 2); }
  // limb darkening
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  const ld = ctx.createRadialGradient(h.x - R * .15, h.y - R * .15, R * .2, h.x, h.y, R);
  ld.addColorStop(0, 'rgba(0,0,0,0)'); ld.addColorStop(.7, `rgba(30,2,0,${(.25 + dark * .35).toFixed(2)})`); ld.addColorStop(1, `rgba(12,0,0,${(.8 + dark * .15).toFixed(2)})`);
  ctx.fillStyle = ld; ctx.fillRect(h.x - R, h.y - R, R * 2, R * 2);
  if (dark > 0) { ctx.globalAlpha = dark * .55; ctx.fillStyle = '#080000'; ctx.fillRect(h.x - R, h.y - R, R * 2, R * 2); }
  ctx.restore();
  // the limb: a thin hot rim and a soft falloff, so the disc's edge isn't a hard cut
  ctx.globalCompositeOperation = 'lighter';
  { const rg = ctx.createRadialGradient(h.x, h.y, R * .9, h.x, h.y, R * 1.12); rg.addColorStop(0, 'rgba(255,120,40,0)'); rg.addColorStop(.42, `rgba(255,${Math.round(110 + temp * 80)},50,${(.55 * vis * (1 - dark * .6)).toFixed(2)})`); rg.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.globalAlpha = 1; ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(h.x, h.y, R * 1.12, 0, Math.PI * 2); ctx.fill(); }
  // prominences: magnetic loops rising off the limb, plasma streaming along them (lighter)
  ctx.globalCompositeOperation = 'lighter';
  if (!st.proms) st.proms = [];
  if (st.proms.length < 3 + Math.round(red * 4) && Math.random() < .02 + red * .03) st.proms.push({ a: Math.random() * Math.PI * 2, span: .25 + Math.random() * .35, hgt: .35 + Math.random() * .55, t0: t, life: 6 + Math.random() * 6 });
  st.proms = st.proms.filter(p => t - p.t0 < p.life);
  for (const p of st.proms) {
    const u = (t - p.t0) / p.life, env = Math.sin(Math.min(1, u) * Math.PI), a0 = p.a + t * .03, a1 = a0 + p.span, am = (a0 + a1) / 2, Hh = R * p.hgt * (.4 + .6 * env);
    const P0 = [h.x + Math.cos(a0) * R * .97, h.y + Math.sin(a0) * R * .97], P1 = [h.x + Math.cos(a1) * R * .97, h.y + Math.sin(a1) * R * .97], C = [h.x + Math.cos(am) * (R + Hh * 1.9), h.y + Math.sin(am) * (R + Hh * 1.9)];
    const pt = k => { const m = 1 - k; return [m * m * P0[0] + 2 * m * k * C[0] + k * k * P1[0], m * m * P0[1] + 2 * m * k * C[1] + k * k * P1[1]]; };
    // a filament: a soft glow plus several thin strands, each pulled a little off the main arc and shimmering
    ctx.globalAlpha = .22 * env * vis * (1 - dark * .5); ctx.strokeStyle = temp > .5 ? '#ff7a2a' : '#b8260c'; ctx.lineWidth = R * .07; ctx.lineCap = 'round'; ctx.filter = 'blur(3px)';
    ctx.beginPath(); ctx.moveTo(P0[0], P0[1]); ctx.quadraticCurveTo(C[0], C[1], P1[0], P1[1]); ctx.stroke(); ctx.filter = 'none';
    for (let k = 0; k < 6; k++) {
      const off = (k - 2.5) * R * .018 + Math.sin(t * 1.7 + k * 1.3 + p.a) * R * .02, nx = Math.cos(am), ny = Math.sin(am);
      ctx.globalAlpha = (.12 + .1 * Math.sin(t * 3 + k)) * env * vis * (1 - dark * .5); ctx.strokeStyle = k % 2 ? '#ffb36a' : '#ffe1b0'; ctx.lineWidth = Math.max(.6, R * .006);
      ctx.beginPath(); ctx.moveTo(P0[0], P0[1]); ctx.quadraticCurveTo(C[0] + nx * off * 3, C[1] + ny * off * 3, P1[0], P1[1]); ctx.stroke();
    }
    for (let k = 0; k < 18; k++) { const q = (t * .22 + k / 18 + p.a) % 1, [x, y] = pt(q), r = R * (.014 + .01 * Math.sin(k + t * 3)); ctx.globalAlpha = .55 * env * vis * Math.sin(q * Math.PI); ctx.drawImage(glowSprite('#ffd08a'), x - r, y - r, r * 2, r * 2); }
  }
  ctx.restore();
};

// ---------------- hooks into the story engine ----------------// ---------------- hooks into the story engine ----------------
{
  // leaving the film (any way) always levels the canvas and drops the HUD
  for (const fn of ['cineEnd', 'storyEnd']) { const f0 = Mesh.prototype[fn]; Mesh.prototype[fn] = function () { const r = f0.apply(this, arguments); if (this.povView) this.povView(null); return r; }; }
  // the POV probe isn't drawn (nor its speech bubble — it's the subtitle) while you look through its eyes
  const pb0 = Mesh.prototype.probeBody;
  Mesh.prototype.probeBody = function (ctx, dt) { const st = this.story; if (st && st.pov != null && st.actors[st.pov] === this.probe) return; return pb0.call(this, ctx, dt); };
  const ps0 = Mesh.prototype.drawProbeSay;
  Mesh.prototype.drawProbeSay = function (ctx) { const st = this.story; if (st && st.pov != null && st.actors[st.pov] === this.probe) { if (this.sayEl) this.sayEl.style.display = 'none'; return; } return ps0.call(this, ctx); };
  const M = Mesh.prototype;
  for (const [k, F] of Object.entries(FILMS)) { STORY_TITLES[k] = [F.title, F.tagline]; STORY_LEN[k] = F.len; STORY_NEED[k] = F.need; M['story_' + k] = function (st, t, dt) { if (!st.film) this.filmStart(k); this.filmStep(st, t, dt); }; }
  for (const k of Object.keys(STORY_LEN)) if (!FILMS[k]) delete STORY_LEN[k];       // (the old short stories are retired)
  // films draw their scene on top of the story layer
  const ds0 = M.drawStory;
  M.drawStory = function (ctx) { const r = ds0.call(this, ctx); try { this.drawFilm(ctx); } catch (e) { console.warn('[film] draw:', e && e.message); } return r; };
  // the scene's stand-ins hide their real bubbles
  const mote0 = M.drawMote;
  M.drawMote = function (n, dt) { const st = this.story; if (st && st.hideSids && st.hideSids.has(n.sid) && !n.__ghost) return; return mote0.call(this, n, dt); };
  // the Endurance where the film has it (breached, drifting, spinning, shaking)
  const eg0 = M.endGeom;
  M.endGeom = function () { const g = eg0.call(this), st = this.story, F = st && st.endFx; if (!F) return g; const j = F.shake || 0; return { ...g, x: g.x + F.dx + (Math.random() - .5) * j, y: g.y + F.dy + (Math.random() - .5) * j, size: g.size * (F.scale || 1) }; };
  const ev0 = M.endView;
  M.endView = function () { const v = ev0.call(this), st = this.story, F = st && st.endFx; return F ? { ...v, yaw: v.yaw + (F.spin || 0), pitch: v.pitch + Math.sin(this.time * 1.7) * .15 * Math.min(1, F.shake || 0) } : v; };
  // the act cards
  const cap0 = M.cineCapInfo;
  M.cineCapInfo = function (S) { if (S.cap === 'act') return { title: true, k: S.act[0], n: S.act[1], m: '' }; return cap0.call(this, S); };
  // a blackout beat (the moment before the bang): drawn over the film
  const dc0 = M.drawCine;
  M.drawCine = function (ctx) { const st = this.story; this.cinePov = !!(st && st.pov != null && st.actors[st.pov]); const r = dc0.call(this, ctx); this.povView(st); if (st && st.blackout > 0) { ctx.save(); ctx.globalAlpha = Math.min(1, st.blackout); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, this.w, this.h); ctx.restore(); } return r; };
}
