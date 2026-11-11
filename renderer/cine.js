// Screen saver (2026-10-28): after 3 minutes without any keyboard or mouse input on this Mac, while Mesh is on
// screen (window visible, mesh showing, not the mini window / Simple mode / Grid), the camera takes over and shoots the
// system like a film (2026-10-29 rework: "more professional cinematics") — authored camera moves on anime.js timelines,
// glides / whip-pans / dips to black between shots, title cards and lower-thirds, 2.39:1 letterbox, anamorphic flare,
// vignette and grain (see "the film" below), in a loop that features different sessions each pass. Any input ends it and the
// camera eases back to exactly where you had it. Window ▸ Screen saver after 3 min idle switches it off.
// Idle time is the Mac's own (powerMonitor), so working in another app with the mesh showing counts as idle; the
// iPhone never runs it. Loaded after probe-life.js.

const CINE_IDLE = 180, CINE_FADE = .45;

Object.assign(Mesh.prototype, {
  cineInit() {
    if (this.cineReady) return; this.cineReady = true;
    this.cineLast = performance.now();
    const bump = () => { this.cineLast = performance.now(); if (this.cine && this.cine.phase !== 'out') this.cineEnd(); };
    for (const ev of ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'pointerdown']) addEventListener(ev, bump, { capture: true, passive: true });
    const st = document.createElement('style'); st.textContent = 'body.cine #meshHint, body.cine #toast { opacity: 0 !important; transition: opacity .6s; }'; document.head.appendChild(st);
    // the Mac's idle clock (any app); polled, so a key pressed elsewhere also ends the show within a second
    if (window.api && window.api.sys && window.api.sys.idle) {
      const poll = async () => { try { const s = await window.api.sys.idle(); if (typeof s !== 'number' || !Number.isFinite(s)) return; this.sysIdle = s; if (this.cine && this.cine.phase !== 'out' && s < 1) this.cineEnd(); } catch { } };
      setInterval(poll, 1000); poll();
    }
  },
  // View ▸ Play Screen Saver: starts 5 s after the click (time to let go of the mouse); any input after that ends it
  cinePlaySoon(opts) {
    this.cineMode = opts && opts.stories ? { stories: true, first: opts.story || null } : null;   // stories only (skip the intro), optionally starting with one
    this.cineInit(); clearTimeout(this.cineSoonT);
    if (typeof toast === 'function') toast('Screen saver in 5 s');
    this.cineSoonT = setTimeout(() => {
      if (this.cine || this.compact || this.lite) return;
      if (document.body.dataset.view === 'grid' && typeof setView === 'function') setView('mesh');
      if (typeof isSimple === 'function' && isSimple()) { this.cineSimple = true; setSimple(false); }   // Simple mode: lifted for the show, back after
      this.cineManual = true; this.cineLast = -1e9; this.cineStart();
    }, 5000);
  },
  cineIdleSeconds() {
    const local = (performance.now() - (this.cineLast || 0)) / 1000;
    return this.sysIdle != null ? Math.min(this.sysIdle, local + 2) : local;
  },
  cineAllowed() {
    // (2026-10-28: only when Mesh is the front window — macOS doesn't report a window that's merely covered, and a
    // saver running behind other apps burnt energy for nobody)
    return !this.lite && !this.compact && !this.paused && !this.offscreen && document.visibilityState === 'visible' && document.hasFocus() && document.body.dataset.view !== 'grid'
      && (this.cineManual || !this.off('mCine')) && !this.drag && !this.spinDrag && !this.pan && !this.objDrag && !this.probeGrab && !document.querySelector('#modal:not(.hidden)');
  },
  // ---------------- the film ----------------
  // One pass = a short documentary of the system, cut like a title sequence:
  //   opening crane-down over the whole system (title card) → slow arcing push on the mother star (anamorphic flare)
  //   → the probe → up to 3 sessions, each a lateral tracking shot with a lower-third (name, state, model, tokens)
  //   joined by whip-pans → the group portals → dip to black → the black hole → glide to the Endurance → closing
  //   pull-back with the title again. Next pass features the next sessions.
  // Each shot's camera move is an anime.js timeline over a little rig { s zoom, ox oy offset (screen px), tilt crane,
  // spin } — paused and scrubbed by the shot clock every frame, so it's frame-exact at any refresh rate and the
  // camera keeps following subjects that orbit. Transitions: 'fade' (dip to black), 'glide' (the camera flies from the
  // last framing to the new one, ease in-out sine), 'whip' (fast in-out expo pan).
  cineShots() {
    const live = [...this.nodes.values()].filter(n => !n.dying && !n.gslot && n.s), P = this.probe;
    const pick = live.sort((a, b) => (b.s.health === 'working') - (a.s.health === 'working') || (b.s.todayTok || 0) - (a.s.todayTok || 0));
    const c = this.cine, from = c.pass * 3 % Math.max(1, pick.length), feat = pick.length ? [0, 1, 2].map(i => pick[(from + i) % pick.length]).filter((n, i, a) => a.indexOf(n) === i) : [];
    const K = (dur, a, b, ease = 'inOutSine') => ({ dur, a, b, ease });
    const S = [
      { k: 'wide', trans: 'fade', cap: 'title', ...K(11, { s: .46, ox: 0, oy: -70, tilt: .16, spin: 0 }, { s: .72, ox: 0, oy: 0, tilt: 0, spin: .5 }, 'inOutQuad') },
      { k: 'hub', trans: 'glide', cap: 'hub', flare: 1, ...K(9, { s: 1.15, ox: -90, oy: 20, tilt: .05 }, { s: 1.95, ox: 50, oy: -10, tilt: -.03 }) },
    ];
    feat.forEach((n, i) => {
      if (i === 0 && P && P.mode !== 'dead' && !P.held && !P.fall) S.push({ k: 'probe', go: P.tidy ? null : n.sid, trans: 'whip', cap: 'probe', ...K(5.5, { s: 1.7, ox: 190, oy: 10 }, { s: 2.1, ox: 110, oy: 0 }) });
      const side = i % 2 ? 1 : -1;
      S.push({ k: 'node', sid: n.sid, trans: i === 0 && S[S.length - 1].k !== 'probe' ? 'glide' : 'whip', cap: 'node', ...K(7.5, { s: 1.8, ox: 210, oy: 30 * side, tilt: .03 * side }, { s: 2.3, ox: 120, oy: -20 * side, tilt: -.02 * side }) });
    });
    for (const g of (this.portalNodes ? this.portalNodes() : []).slice(0, 2)) S.push({ k: 'node', sid: g.sid, trans: 'glide', cap: 'group', open: true, ...K(9, { s: .72, ox: 160, oy: 10, spin: 0 }, { s: .95, ox: 110, oy: -5, spin: .25 }) });   // (its sling-ring opens for the shot: cine-stories.js)
    if (!this.off('mBlackHole')) S.push({ k: 'bh', trans: 'fade', cap: 'bh', ...K(8, { s: 1.15, ox: 0, oy: 40, tilt: .06 }, { s: 1.9, ox: 0, oy: -15, tilt: 0 }, 'inOutQuad') });
    if (!this.off('mEndurance')) S.push({ k: 'end', trans: 'glide', cap: 'end', ...K(8, { s: 1.25, ox: 230, oy: 0 }, { s: 2.05, ox: 140, oy: -10 }) });
    S.push({ k: 'wide', trans: 'glide', cap: 'close', ...K(10, { s: .95, ox: 0, oy: 0, tilt: 0, spin: 0 }, { s: .55, ox: 0, oy: -40, tilt: .12, spin: -.4 }, 'inOutQuad') });
    return S;
  },
  cineStart() {
    const c = this.cam;
    this.cine = { phase: 'in', t: 0, i: -1, pass: 0, fade: 1, saved: { s: c.ts, tx: c.ttx, ty: c.tty, rot: this.sysRot || 0, tilt: this.sysTilt || 0 }, cur: null };
    document.body.classList.add('cine'); this.sysVel = 0;
    // the hangar's counts for the Endurance's caption (main.js hangar:list)
    if (window.api && window.api.hangar) window.api.hangar().then(d => { if (!d) return; const sk = d.skills || []; this.cineHangar = { skills: sk.filter(x => x.src === 'skill').length, commands: sk.filter(x => x.src === 'command').length, plugins: new Set(sk.filter(x => x.src === 'plugin').map(x => x.plugin || x.name.split(':')[0])).size, connectors: (d.connectors || []).length }; }).catch(() => { });
    // the probe tidies the mesh while the film rolls (Kevin 2026-10-29); the film's probe shot follows it at work
    const P = this.probe; if (this.probeTidy && P && !P.tidy && P.mode !== 'dead' && !P.held && !P.fall) this.probeTidy();
    this.cineNext();
  },
  cineNext() {
    const c = this.cine;
    if (!c.shots || c.i + 1 >= c.shots.length) { c.shots = this.cineShots(); c.i = -1; if (c.shots.length === 0) return this.cineEnd(); c.pass++; }
    c.i++; c.t = 0; c.shot = c.shots[c.i]; c.from = c.cur && { ...c.cur }; c.spun = 0;
    const S = c.shot; if (S.go && this.probeGo && this.probeFind && this.probeFind(S.go)) this.probeGo([S.go]);
    // the shot's camera move: a paused anime.js timeline over the rig, scrubbed by cineStep
    S.rig = { s: 1, ox: 0, oy: 0, tilt: 0, spin: 0, ...S.a };
    const to = Object.fromEntries(Object.keys(S.b).map(k => [k, [S.a[k] ?? 0, S.b[k]]]));
    S.tl = window.anime ? anime.createTimeline({ autoplay: false }).add(S.rig, { ...to, duration: S.dur * 1000, ease: S.ease }) : null;
    this.cineCaption(S);
  },
  cineEnd() {
    const c = this.cine; if (!c || c.phase === 'out') return;
    c.phase = 'out'; c.t = 0; document.body.classList.remove('cine'); this.cineHiOff = false; this.cineCaption(null);
  },
  // where the current shot looks (world coords); null = the shot's subject is gone → next shot
  cineTarget(S) {
    if (S.k === 'wide') return { x: this.hub.x, y: this.hub.y - 10 };
    if (S.k === 'hub') return { x: this.hub.x, y: this.hub.y };
    if (S.k === 'bh') { const B = this.bhGeom(); return { x: B.x, y: B.y - B.Rs * .3 }; }
    if (S.k === 'end') { const G = this.endGeom(); return { x: G.x, y: G.y }; }
    if (S.k === 'probe') { const P = this.probe; return P && P.mode !== 'dead' ? { x: P.dx, y: P.dy } : null; }
    const n = this.probeFind ? this.probeFind(S.sid) : this.nodes.get(S.sid); return n && !n.dying ? { x: n.x, y: n.y } : null;
  },
  cineStep(dt) {
    this.cineInit();
    if (!this.cine) { if (this.cineAllowed() && this.cineIdleSeconds() >= CINE_IDLE) this.cineStart(); return; }
    const c = this.cine, cam = this.cam, ease = u => u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    c.t += dt; this.cineClean = c.phase !== 'out';            // the film shows no labels / cards / speech (lower-thirds instead)
    // the display's full rate (144 fps on the mini) while the Mac keeps up: every 2 s the real rate is checked; under 80% of
    // the display's rate (busy CPU / GPU) the show drops to 60 fps, and tries the full rate again after 30 s
    { const now = performance.now(), W = c.rate || (c.rate = { t0: now, n: 0 });
      W.n++;
      if (now - W.t0 >= 2000) {
        const fps = W.n * 1000 / (now - W.t0); W.t0 = now; W.n = 0;
        if (!this.cineHiOff && fps < (1000 / (this.tickMs || 7)) * .8 && c.t > 3) { this.cineHiOff = true; this.cineHiAt = now; }
        else if (this.cineHiOff && now - (this.cineHiAt || 0) > 30000) this.cineHiOff = false;
      } }
    if (c.phase === 'out') {                                                    // back to where you had it
      const u = Math.min(1, c.t / 1.1), e = ease(u), v = c.saved;
      cam.s += (v.s - cam.s) * Math.min(1, dt * 4); cam.tx += (v.tx - cam.tx) * Math.min(1, dt * 4); cam.ty += (v.ty - cam.ty) * Math.min(1, dt * 4);
      cam.ts = cam.s; cam.ttx = cam.tx; cam.tty = cam.ty;
      this.sysRot += (v.rot - this.sysRot) * Math.min(1, dt * 4); this.sysTilt += (v.tilt - this.sysTilt) * Math.min(1, dt * 4);
      c.fade = 0;
      if (u >= 1) { this.cineClean = false; Object.assign(cam, { s: v.s, tx: v.tx, ty: v.ty, ts: v.s, ttx: v.tx, tty: v.ty }); this.sysRot = v.rot; this.sysTilt = v.tilt; this.cine = null; this.cineManual = false; if (this.cineSimple) { this.cineSimple = false; setSimple(true); } }
      return;
    }
    if (!this.cineAllowed()) return this.cineEnd();
    const S = c.shot, T = this.cineTarget(S);
    if (!T) return this.cineNext();
    const u = Math.min(1, c.t / S.dur), R = S.rig;
    if (S.tl) S.tl.seek(u * S.dur * 1000); else { const e = ease(u); for (const k in S.b) R[k] = (S.a[k] ?? 0) + (S.b[k] - (S.a[k] ?? 0)) * e; }
    // the rig → the camera: framed on the subject (which may be orbiting), offset in screen px, crane = tilt, spin = turns
    if (R.spin != null) { const d = R.spin - c.spun; this.sysRot = (this.sysRot || 0) + d; c.spun = R.spin; }
    this.sysTilt = c.saved.tilt + (R.tilt || 0) + Math.sin(c.pass * 3 + c.t * .3) * .012;   // + a breath of handheld
    let want = { x: T.x - R.ox / R.s, y: T.y - R.oy / R.s, s: R.s };
    // the transition into this shot: from the last framing, eased (glide: slow sine, whip: fast expo)
    const TR = { glide: 1.8, whip: .75 }[S.trans] || 0;
    if (c.from && TR && c.t < TR) {
      const v = c.t / TR, E = window.anime ? anime.eases[S.trans === 'whip' ? 'inOutExpo' : 'inOutSine'](v) : ease(v);
      // zoom travels in log space (a zoom out-and-in reads as one move); a whip dips out a little mid-pan
      const ls = Math.log(c.from.s) + (Math.log(want.s) - Math.log(c.from.s)) * E, dip = S.trans === 'whip' ? 1 - .18 * Math.sin(v * Math.PI) : 1 - .1 * Math.sin(v * Math.PI);
      want = { x: c.from.x + (want.x - c.from.x) * E, y: c.from.y + (want.y - c.from.y) * E, s: Math.exp(ls) * dip };
      c.whip = S.trans === 'whip' ? Math.sin(v * Math.PI) : 0;
    } else c.whip = 0;
    const q = c.cur || (c.cur = { ...want }), k = Math.min(1, dt * 14);           // a fluid head: absorbs jitter, never lags a shot
    q.x += (want.x - q.x) * k; q.y += (want.y - q.y) * k; q.s += (want.s - q.s) * k;
    cam.s = q.s; cam.tx = this.w / 2 - q.x * q.s; cam.ty = this.h / 2 - q.y * q.s; cam.ts = cam.s; cam.ttx = cam.tx; cam.tty = cam.ty;
    // dips to black only where the next shot is a 'fade' (and the very first shot fades in)
    const nx = c.shots[c.i + 1], outFade = !nx || nx.trans === 'fade' ? Math.max(0, (c.t - (S.dur - CINE_FADE)) / CINE_FADE) : 0;
    const inFade = c.phase === 'in' ? Math.max(0, 1 - c.t / 1.6) : S.trans === 'fade' ? Math.max(0, 1 - c.t / CINE_FADE) : 0;
    c.fade = Math.min(1, Math.max(outFade, inFade));
    if (c.phase === 'in' && c.t > 1.6) c.phase = 'run';
    if (u >= 1) this.cineNext();
  },
  // ---------------- the film look (screen space) ----------------
  // 2.39:1 letterbox, an anamorphic streak on the star in its shot, a lens vignette, a whip-pan smear and film grain.
  drawCine(ctx) {
    const c = this.cine; if (!c) return;
    const W = this.w, H = this.h, cam = this.cam, t = this.time;
    const inA = c.phase === 'out' ? Math.max(0, 1 - c.t / .7) : Math.min(1, c.t / 1.4 + (c.phase === 'run' ? 1 : 0)), A = inA * inA * (3 - 2 * inA);
    const bar = Math.min(H * .12, Math.max(H * .07, (H - W / 2.39) / 2)) * A;
    ctx.save();
    // anamorphic flare: a long thin horizontal streak through the mother star (its shot, and faintly on the wides)
    const S = c.shot, fl = c.phase === 'out' ? 0 : S && S.flare ? 1 : S && S.k === 'wide' ? .35 : 0;
    if (fl && typeof glowSprite === 'function') {
      const hx = cam.tx + this.hub.x * cam.s, hy = cam.ty + this.hub.y * cam.s, L = W * (.55 + .1 * Math.sin(t * .4)), th = 7 + 3 * cam.s;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = .42 * fl * A; ctx.drawImage(glowSprite('#8fc8ff'), hx - L, hy - th, L * 2, th * 2);
      ctx.globalAlpha = .55 * fl * A; ctx.drawImage(glowSprite('#e8f4ff'), hx - L * .35, hy - th * .35, L * .7, th * .7);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    // whip-pan smear: soft horizontal streak bands while the camera rushes
    if (c.whip > .05) { ctx.globalAlpha = .22 * c.whip; ctx.drawImage(this.cineSmear(), 0, 0, W, H); ctx.globalAlpha = 1; }
    // the lens: a vignette, then the grain
    ctx.globalAlpha = A; ctx.drawImage(this.cineVignette(W, H), 0, 0, W, H);
    const G = this.cineGrain(); ctx.globalAlpha = .07 * A; ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = G.pat; ctx.translate(-((t * 997) % 256), -((t * 613) % 256)); ctx.fillRect(0, 0, W + 256, H + 256);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.restore(); ctx.save(); ctx.fillStyle = '#000';
    if (bar > 0 && !this.cinePov) { ctx.fillRect(0, 0, W, bar); ctx.fillRect(0, H - bar, W, bar); }   // (not through a probe's eyes: the canvas is turned then; its HUD frames the view)
    if (c.fade > 0) { ctx.globalAlpha = c.fade; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
    this.cineBar = bar;
  },
  cineVignette(W, H) {
    const V = this.cineV; if (V && V.w === W && V.h === H) return V.c;
    const cv = document.createElement('canvas'); cv.width = Math.max(2, Math.round(W / 4)); cv.height = Math.max(2, Math.round(H / 4));
    const x = cv.getContext('2d'), g = x.createRadialGradient(cv.width / 2, cv.height / 2, Math.min(cv.width, cv.height) * .35, cv.width / 2, cv.height / 2, Math.hypot(cv.width, cv.height) * .55);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(.7, 'rgba(0,0,0,.28)'); g.addColorStop(1, 'rgba(0,0,0,.72)');
    x.fillStyle = g; x.fillRect(0, 0, cv.width, cv.height); this.cineV = { w: W, h: H, c: cv }; return cv;
  },
  cineGrain() {
    if (this.cineG) return this.cineG;
    const cv = document.createElement('canvas'); cv.width = cv.height = 256; const x = cv.getContext('2d'), im = x.createImageData(256, 256);
    for (let i = 0; i < im.data.length; i += 4) { const v = 128 + (Math.random() + Math.random() + Math.random() - 1.5) * 120; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
    x.putImageData(im, 0, 0); return (this.cineG = { c: cv, pat: x.createPattern(cv, 'repeat') });
  },
  cineSmear() {
    if (this.cineSm) return this.cineSm;
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 256; const x = cv.getContext('2d');
    for (let i = 0; i < 46; i++) { const y = Math.random() * 256, h = .5 + Math.random() * 2.5; x.fillStyle = `rgba(${180 + Math.random() * 75 | 0},${200 + Math.random() * 55 | 0},255,${(.05 + Math.random() * .25).toFixed(2)})`; x.fillRect(0, y, 64, h); }
    return (this.cineSm = cv);
  },

  // ---------------- lower-thirds (DOM, animated with anime.js) ----------------
  // Title cards and lower-thirds: a thin rule draws in, the name rises letter by letter, the details follow; out with a
  // fade-up before the next shot. Text in the app's own face; sits inside the letterbox's safe area.
  cineCaption(S) {
    let el = this.cineCapEl;
    if (!el) {
      el = this.cineCapEl = document.createElement('div'); el.id = 'cineCap';
      el.innerHTML = '<i class="cc-rule"></i><div class="cc-k"></div><div class="cc-n"></div><div class="cc-m"></div>';
      const st = document.createElement('style');
      st.textContent = `#cineCap { position: absolute; bottom: 0; pointer-events: none; z-index: 5; color: #f2f4f8; opacity: 0; max-width: 60%; }
        #cineCap.title { text-align: center; }
        #cineCap::before { content: ''; position: absolute; inset: -46px -90px -34px -70px; z-index: -1; background: radial-gradient(ellipse at 35% 62%, rgba(0,0,0,.62), rgba(0,0,0,0) 68%); }
        #cineCap.title::before { inset: -40px 18%; background: radial-gradient(ellipse at 50% 60%, rgba(0,0,0,.55), rgba(0,0,0,0) 70%); }
        #cineCap .cc-n, #cineCap .cc-m { text-shadow: 0 1px 12px rgba(0,0,0,.6); }
        #cineCap .cc-rule { display: block; height: 1px; width: 56px; background: linear-gradient(90deg, #9fd3ff, rgba(159,211,255,0)); transform-origin: left; margin-bottom: 12px; }
        #cineCap.title .cc-rule { margin: 0 auto 14px; transform-origin: center; width: 120px; background: linear-gradient(90deg, rgba(159,211,255,0), #9fd3ff, rgba(159,211,255,0)); }
        #cineCap .cc-k { font-size: 11.5px; letter-spacing: .08em; color: #9fb4d0; margin-bottom: 6px; }
        #cineCap .cc-n { font-size: 30px; font-weight: 300; letter-spacing: .01em; line-height: 1.12; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        #cineCap.title .cc-n { font-size: 44px; font-weight: 200; letter-spacing: .14em; }
        #cineCap .cc-n span { display: inline-block; white-space: pre; }
        #cineCap .cc-m { font-size: 13px; line-height: 1.5; color: #b8c2d4; margin-top: 8px; font-variant-numeric: tabular-nums; }
        #cineCap .cc-m b { font-weight: 500; color: #e8edf5; }`;
      document.head.appendChild(st); (this.c.parentElement || document.body).appendChild(el);
    }
    const A = window.anime; if (A) A.remove(el.querySelectorAll('*')), A.remove(el);
    clearTimeout(this.cineCapT);
    const info = S && this.cineCapInfo(S);
    if (!info) { if (A) A.animate(el, { opacity: 0, duration: 400, ease: 'outQuad' }); else el.style.opacity = 0; return; }
    const put = () => {
      el.className = info.title ? 'title' : '';
      el.querySelector('.cc-k').textContent = info.k || ''; el.querySelector('.cc-m').innerHTML = info.m || '';
      el.querySelector('.cc-n').innerHTML = [...info.n].map(ch => `<span>${ch.replace(/[&<>]/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[x]))}</span>`).join('');
      const cv = this.c, cw = cv.clientWidth, par = el.offsetParent || document.body, pr = par.getBoundingClientRect(), cr = cv.getBoundingClientRect();
      el.style.transform = ''; el.style.bottom = Math.round(pr.bottom - cr.bottom + (this.cineBar || this.h * .1) + this.h * .045) + 'px';
      if (info.title) { el.style.left = Math.round(cr.left - pr.left) + 'px'; el.style.width = cw + 'px'; el.style.maxWidth = 'none'; }
      else { el.style.left = Math.round(cr.left - pr.left + cw * .065) + 'px'; el.style.width = ''; el.style.maxWidth = Math.round(cw * .55) + 'px'; }
      if (!A) { el.style.opacity = 1; return; }
      el.style.opacity = 1;
      A.createTimeline({ defaults: { ease: 'outExpo' } })
        .add(el.querySelector('.cc-rule'), { scaleX: [0, 1], opacity: [0, 1], duration: 900 })
        .add(el.querySelector('.cc-k'), { opacity: [0, 1], translateY: [8, 0], duration: 700 }, '-=650')
        .add(el.querySelectorAll('.cc-n span'), { opacity: [0, 1], translateY: ['0.45em', 0], filter: ['blur(6px)', 'blur(0px)'], duration: 900, delay: A.stagger(info.title ? 55 : 22) }, '-=550')
        .add(el.querySelector('.cc-m'), { opacity: [0, 1], translateY: [6, 0], duration: 800 }, '-=600');
      // out a little before the shot ends
      this.cineCapT = setTimeout(() => A.animate(el, { opacity: 0, translateY: [0, -6], duration: 650, ease: 'inQuad', onComplete: () => { el.style.transform = ''; } }), Math.max(1500, ((S.capDur || S.dur) - 1.6) * 1000));
    };
    // let the transition land before the caption comes in (a whip: right after; a glide / fade: once it's settled)
    if (A && +getComputedStyle(el).opacity > .05) A.animate(el, { opacity: 0, duration: 250, ease: 'outQuad' });
    this.cineCapT = setTimeout(put, S.trans === 'whip' ? 650 : S.trans === 'glide' ? 1300 : 900);
  },
  cineCapInfo(S) {
    const sn = typeof snap !== 'undefined' && snap ? snap : {}, ft = typeof fmtTok === 'function' ? fmtTok : v => String(v | 0), live = (sn.sessions || []).filter(s => !s.offline);
    const work = live.filter(s => s.health === 'working').length, d = new Date();
    if (S.cap === 'title') return { title: true, n: APP_NAME, k: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }), m: `<b>${live.length}</b> sessions  ·  <b>${work}</b> working  ·  <b>${ft(sn.todayTok)}</b> tokens today` };
    if (S.cap === 'close') return { title: true, n: APP_NAME, k: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }), m: 'Mission control for Claude Code' };
    if (S.cap === 'hub') return { k: 'The mother star', n: `${work} of ${live.length} at work`, m: `<b>${ft(this.hub.tps || 0)}</b> tok/s  ·  <b>$${(sn.todayUsd || 0).toFixed(2)}</b> today` };
    if (S.cap === 'probe') { const P = this.probe, R = () => '0'; return P.tidy ? { k: 'Housekeeping', n: `Probe Mk ${R(P.gen || 1)}`, m: `Arranging the sessions  ·  <b>${P.tidy.q.done}</b> of <b>${P.tidy.q.jobs.length}</b> in place` } : { k: 'Patrol', n: `Probe Mk ${R(P.gen || 1)}`, m: 'Scanning the sessions that need you' }; }
    if (S.cap === 'bh') {                                                       // the sessions that have sat unused longest: candidates to drop in
      const stale = live.filter(s => s.health === 'idle' && (s.sinceWrite || 0) > 2 * 86400).sort((a, b) => (b.sinceWrite || 0) - (a.sinceWrite || 0)).slice(0, 4);
      const age = s => { const d = (s.sinceWrite || 0) / 86400; return d >= 1.5 ? Math.round(d) + ' days' : Math.round(d * 24) + ' h'; };
      return { k: 'Event horizon', n: 'The black hole', m: stale.length ? 'Unused longest, ready to drop in: ' + stale.map(s => `<b>${esc(s.name)}</b> ${age(s)}`).join('  ·  ') : 'Nothing stale. Every session has been used in the last two days' };
    }
    if (S.cap === 'end') {                                                      // what the hangar holds, and the probe crew
      const H = this.cineHangar, n = (this.probes || [this.probe]).filter(P => P && P.mode !== 'dead').length;
      const parts = H ? [[H.skills, 'skills'], [H.commands, 'commands'], [H.plugins, 'plugins'], [H.connectors, 'connectors']].map(([v, l]) => `<b>${v}</b> ${l}`) : [];
      return { k: 'Dock', n: 'Endurance', m: [...parts, `<b>${n}</b> ${n === 1 ? 'probe' : 'probes'} on duty`].join('  ·  ') };
    }
    if (S.cap === 'group') { const P = this.portals && this.portals.get(S.sid.slice(4)); if (!P) return null; const names = (P.members || []).map(n => n.s && n.s.name).filter(Boolean); return { k: `Group · ${names.length} sessions${P.work ? ' · working' : ''}`, n: P.name || 'Group', m: names.slice(0, 6).map(x => `<b>${esc(x)}</b>`).join('  ·  ') + (names.length > 6 ? `  ·  +${names.length - 6} more` : '') }; }
    const n = this.nodes.get(S.sid), s = n && n.s; if (!s) return null;
    const st = { working: 'Working', waiting: 'Waiting on you', error: 'Error', quiet: 'Quiet', idle: 'Idle' }[s.health] || s.health || '';
    return { k: st, n: s.name || 'Session', m: [s.model && `<b>${String(s.model).replace(/^claude-/, '')}</b>`, s.todayTok ? `<b>${ft(s.todayTok)}</b> tokens today` : null, s.tps ? `<b>${Math.round(s.tps)}</b> tok/s` : null].filter(Boolean).join('  ·  ') };
  },
});
