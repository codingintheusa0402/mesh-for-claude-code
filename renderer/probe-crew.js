// The probe crew (2026-10-29): up to 3 probes at once, each in its own paint (the lead keeps its colours; crew probes are
// turned round the hue wheel), sharing the work instead of tripping over each other:
//   · a tidy-up is one shared queue — every probe takes the next bubble (probe-tidy.js); 6+ bubbles → the Endurance
//     launches crew probes to help;
//   · a delivery (hangar implant) goes to the nearest free probe; all busy → the Endurance launches one (probe-deliver.js);
//   · a tour of several sessions ("Check what needs me", the scan list) is split between the free probes;
//   · on patrol no two probes pick the same session;
//   · crew probes idle for 3 minutes fly home and dock; one lost to the black hole / the star isn't rebuilt (the lead is).
// How: each probe keeps its own state object; the probe code (probe.js and friends) works on `this.probe`, so every
// frame it's run once per probe with `this.probe` (and its own speech bubble) swapped in. Probe menu: "Launch a crew
// probe" / "Recall the crew". Loaded after probe-deliver.js.

const CREW_MAX = 3, CREW_HUE = [0, 125, 235], CREW_IDLE = 180;
// names (Kevin 2026-10-30): the Chief is always Probe Mk 0; crew probes count up from Mk I, and the count starts over
// at Mk I once the whole crew is home

Object.assign(Mesh.prototype, {
  crew() {
    if (!this.probes) { const L = this.probeState(); L.crew = 0; L._sayEl = this.sayEl; L._sayB = this.sayB; this.probes = [L]; }
    return this.probes;
  },
  probeName(P) { return P && P.crew ? `Probe Mk ${ROMAN(P.mk || 1)}` : 'Probe Mk 0'; },
  crewFree(P) { return P && P.mode !== 'dead' && !P.held && !P.fall && !P.deliver && !P.recall; },
  // launch n crew probes from the Endurance's dock (≤ 3 probes in all); returns how many went out
  crewLaunch(n = 1) {
    const F = this.crew(), L = F[0]; let k = 0;
    if (this.compact || this.off('mEndurance') || this.off('mProbe')) return 0;
    while (F.length < CREW_MAX && k < n) {
      const keep = this.probe; this.probe = null; const P = this.probeState(); this.probe = keep;
      const slot = [1, 2].find(i => !F.some(o => o.crew === i)), d = this.endDock ? this.endDock() : { x: this.hub.x, y: this.hub.y }, t = this.time;
      Object.assign(P, { x: d.x, y: d.y, vx: (slot === 1 ? -1 : 1) * 160, vy: -240, crew: slot, mode: 'roam', until: t + 4, idleSince: t, workAt: t, nextLand: t + 25, gen: L.gen, hue: L.hue, z: 0 });
      if (F.length === 1) this.crewMk = 0; P.mk = this.crewMk = (this.crewMk || 0) + 1;
      P.say = { text: probeLine('crewLaunch', ['Crew probe reporting. Who do I gotta sort out?', 'Backup\'s here, motherfuckers.', 'Shift change. Point me at the mess.', 'They let me out early for good behavior. Where\'s the work?']), health: 'working', name: this.probeName(P), t0: t, hold: t + 3 };
      F.push(P); k++;
    }
    return k;
  },
  crewRecall() { for (const P of this.crew()) if (P.crew) { P.recall = true; P.tidy = null; P.queue = null; P.target = null; } },
  // per frame, after the probes moved: idle crew go home
  crewStep() {
    const F = this.crew(), t = this.time;
    for (const P of F) {
      if (P.tidy || P.deliver || P.mode === 'fly' || P.mode === 'land' || P.mode === 'swoop' || P.held) P.workAt = t;
      if (P.crew && !P.recall && t - (P.workAt ?? t) > CREW_IDLE) {
        P.recall = true; P.say = { text: probeLine('crewHome', ['Shift\'s over. I\'m clocking out.', 'Nothing left to do. Back to the bunk.', 'I\'m out. Call me when shit hits the fan.']), health: 'idle', name: this.probeName(P), t0: t, hold: t + 2.5 };
      }
    }
  },
  // the flight home: to the dock, shrinking in; then it's off the crew
  crewHomeStep(P, dt, base) {
    const d = this.endDock ? this.endDock() : { x: this.hub.x, y: this.hub.y }, t = this.time, S = base;
    const k = 8, ax = (d.x - P.x) * k - P.vx * 2 * Math.sqrt(k) * .9, ay = (d.y - P.y) * k - P.vy * 2 * Math.sqrt(k) * .9;
    P.vx += ax * dt; P.vy += ay * dt; const sp = Math.hypot(P.vx, P.vy); if (sp > 520) { P.vx *= 520 / sp; P.vy *= 520 / sp; }
    P.x += P.vx * dt; P.y += P.vy * dt;
    const dist = Math.hypot(d.x - P.x, d.y - P.y); P.gs = Math.max(.15, Math.min(1, dist / 120));
    { const want = sp > 25 ? Math.atan2(P.vx, P.vy) : 0; let a = want - P.yaw; a = Math.atan2(Math.sin(a), Math.cos(a)); P.yaw += a * Math.min(1, dt * 5); }
    if (P.say && !P.say.out && !(P.say.hold > t)) P.say.out = t;
    if (P.say && P.say.out && t - P.say.out > .45) P.say = null;
    P.S = S * P.gs; P.dx = P.x; P.dy = P.y; P.sp = sp; P.z += (0 - P.z) * Math.min(1, dt * 3);
    if (dist < 14 || t - (P.homeT0 ??= t) > 9) P.gone = true;            // (the dock moves as the Endurance turns: it never takes more than 9 s)
    return true;
  },
});

{
  const M = Mesh.prototype;
  // run a probe routine for every probe: this.probe and its own speech bubble swapped in, the lead (or the one you last
  // touched) left as this.probe afterwards
  const SWAP = ['sayEl', 'sayB'];
  M.crewEach = function (fn) {
    const F = this.crew(), focus = this.probeFocus && F.includes(this.probeFocus) ? this.probeFocus : F[0], hov = this.probeHover, pm = this.pmEl;
    for (const P of F.slice()) {
      this.probe = P; for (const k of SWAP) this[k] = P['_' + k];
      this.probeHover = hov && P === (this.probeHoverP || focus); this.pmEl = P === focus ? pm : null;
      fn(P);
      for (const k of SWAP) P['_' + k] = this[k];
    }
    this.probeHover = hov; this.pmEl = pm;
    for (const P of F.filter(P => P.gone)) { if (P._sayEl) P._sayEl.remove(); F.splice(F.indexOf(P), 1); }
    this.probe = F.includes(focus) ? focus : F[0]; for (const k of SWAP) this[k] = this.probe['_' + k];
  };
  const draw0 = M.drawProbe;
  M.drawProbe = function (ctx, dt, layer) { this.crewEach(() => draw0.call(this, ctx, dt, layer)); if (layer === 'front') this.crewStep(); };
  const say0 = M.drawProbeSay;
  M.drawProbeSay = function (ctx) { this.crewEach(P => { if (P.say && /^Probe( Mk| B| C)?$/.test(P.say.name || '') && P.say.name !== this.probeName(P)) P.say.name = this.probeName(P); say0.call(this, ctx); }); };
  // each probe's paint: the lead as built, the crew turned round the hue wheel (probeBody reads P.hue)
  const body0 = M.probeBody;
  M.probeBody = function (ctx, dt) { const P = this.probe, h = P.hue; P.hue = (h || 0) + CREW_HUE[P.crew || 0]; try { return body0.call(this, ctx, dt); } finally { P.hue = h; } };
  // which probe is under the pointer: that one is the one the menu / a grab acts on
  const hit0 = M.hitProbe;
  M.hitProbe = function (p) {
    const F = this.crew(), keep = this.probe; let hit = null;
    for (const P of F) { this.probe = P; if (hit0.call(this, p)) { hit = P; break; } }
    this.probe = hit || keep; if (hit) { this.probeFocus = hit; this.probeHoverP = hit; }
    return !!hit;
  };
  // the life hooks: crew going home, crew lost (not rebuilt)
  const life0 = M.probeLife;
  M.probeLife = function (P, dt, base) {
    if (P.crew && P.mode === 'dead') { P.gone = true; return true; }
    if (P.crew && P.fall && P.fall.done) { P.gone = true; return true; }
    if (P.recall && !P.held && !P.fall) return this.crewHomeStep(P, dt, base);
    return life0.call(this, P, dt, base);
  };
  const die0 = M.probeDie;
  M.probeDie = function (cause) {
    const P = this.probe;
    if (P && P.crew) { P.mode = 'dead'; P.fall = null; P.gone = true; const L = this.crew()[0]; if (L && L !== P && L.mode !== 'dead') L.say = { text: `Lost ${this.probeName(P)} ${cause === 'star' ? 'in the star' : 'to the hole'}. Poor bastard.`, health: 'error', name: 'Probe Mk 0', t0: this.time, hold: this.time + 3 }; return; }
    return die0.call(this, cause);
  };
  // the Endurance's build bay shows the lead's rebuild
  const build0 = M.drawProbeBuild;
  if (build0) M.drawProbeBuild = function (ctx, G) { const keep = this.probe; this.probe = this.crew()[0]; try { return build0.call(this, ctx, G); } finally { this.probe = keep; } };
  // patrol: no two probes on the same session
  const next0 = M.probeNext;
  M.probeNext = function (P) {
    next0.call(this, P);
    const F = this.probes; if (!F || F.length < 2) return;
    for (let i = 0; i < 4 && P.target && F.some(o => o !== P && o.target === P.target); i++) next0.call(this, P);
  };
  // a tour of several sessions: split between the free probes
  const go0 = M.probeGo;
  M.probeGo = function (sids) {
    const F = this.crew().filter(P => this.crewFree(P) && !P.tidy);
    if (!sids || sids.length < 2 || F.length < 2) return go0.call(this, sids);
    const keep = this.probe;
    F.forEach((P, i) => { const part = sids.filter((_, j) => j % F.length === i); if (part.length) { this.probe = P; go0.call(this, part); } });
    this.probe = keep;
  };
  // a delivery: the nearest free probe (not tidying if possible); everyone busy → launch one
  const del0 = M.probeDeliver;
  if (del0) M.probeDeliver = function (sid, item, cb) {
    const F = this.crew(), d = this.endDock ? this.endDock() : { x: 0, y: 0 };
    let C = F.filter(P => this.crewFree(P));
    if (!C.some(P => !P.tidy) && this.crewLaunch(1)) C = this.crew().filter(P => this.crewFree(P));
    C.sort((a, b) => (!!a.tidy - !!b.tidy) || (Math.hypot(a.x - d.x, a.y - d.y) - Math.hypot(b.x - d.x, b.y - d.y)));
    if (!C.length) return false;
    const keep = this.probe; this.probe = C[0];
    try { return del0.call(this, sid, item, cb); } finally { this.probe = keep; }
  };
  // the speech header names which probe is talking
  const doing0 = M.probeDoing;
  M.probeDoing = function () { const P = this.probeState(), n = this.crew().length; return `${this.probeName(P)}${n > 1 ? ` (${n} on the crew)` : ''} · ` + doing0.call(this); };
}
