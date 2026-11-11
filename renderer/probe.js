// The probe: a little blue droid (modelled in Blender — assets/probe/build_probe.py — and pre-rendered as 32 yaw frames
// in probe/probe_sheet.png, 8 × 4 cells of 192 px, frame 0 facing the camera) that lives in the mesh.
// Its routine (user ask 2026-10-24; what it actually does will come later):
//   cruise — flies along the main orbit ring for a while, fire blasting from its rear engine
//   roam   — wanders around the system with no destination, from one random spot to the next (2026-10-24)
//   land   — once every 3 minutes it picks one bubble, flies over and lands on top of it (facing you), rides along
//            for a few seconds, then goes back to cruising / roaming
//   swoop  — about half the landings: the Interstellar "boomerang" approach — engines low, it glides in on a wide
//            curve past the bubble, banks round and comes back from the far side, then a retro-burst flare to set down
//   hot    — "hot" sessions (name has "incident"): whenever one
//            posts a new reply, it flies straight there (at most once a minute) and reads the latest update out
//   sleep  — no session working for 5 minutes: it flies home to the Endurance (endurance.js; 2026-10-27, it used to be
//            the mother star), docks on its hub and dozes (Zzz) until a session starts working again, then wakes with a
//            start and goes back on patrol
// It turns to face where it's flying. Loaded after portal.js.
// 2026-10-24: when it lands it says something about that session in a game-style speech bubble above it (waiting for
// you, errors, context nearly full, busy, healthy …; with nothing to report, a joke about the session), and it follows
// perspective: on the far half of the orbit it's smaller, dimmer and drawn behind the star, on the near half bigger.
// 2026-10-26: on a session it reports that session's latest work (your last prompt, files it edited, commands it ran,
// what Claude last said), status first if it's waiting / erroring; some landings are on the mother star instead, where
// it gives the health of Claude Code and Mesh (sessions, spend, plan limits, fps, peer Mac) — also when it goes to sleep.
// 2026-10-26: it no longer touches down on a bubble — it hovers above and scans it with a UFO-style tractor beam (teal
// cone that swallows the bubble, flickering rays, motes rising into the probe, a scan ring sweeping over the sphere);
// the speech bubble comes once the first sweep is done, and the beam retracts before it flies off.
// 2026-10-26: the bubble is real HTML over the canvas: text can be selected / copied, links open in the browser, and
// while the pointer is on it (a tap on the phone: 10 s) the probe stays put and the bubble stays. Session reports are
// just the status quo now — state + the one fact that matters (the question it's asking, the error, the task it's on).
// 2026-10-27: pointing at it lights it up (a white sheen) and it brakes so you can catch it; a click opens its command
// menu — scan a session you pick, visit everything that needs you, health check on the mother star, say the last
// report again, stay here / resume patrol, nap / wake up.
// 2026-10-27: who it is — an ex-con. It did a long stretch, and rather than rot in a cell forever it took the job as the
// Mesh probe. It talks like the yard: prison slang and swearing on every report (the facts first, then its two cents).

const pick2 = a => a[Math.random() * a.length | 0];
// its two cents after a report, by the session's state: an ex-con's view of the yard
const PROBE_CON = {
  waiting: ['It\'s waiting on you like a con waiting on parole. Answer the goddamn thing.', 'Motherfucker\'s been standing at the bars forever. Talk to it!', 'Even the screws answered faster than you, asshole.', 'For fuck\'s sake, it\'s waiting on YOU.'],
  error: ['Shit\'s on fire in this cell block.', 'Fuck me, this one\'s catching hell. Call the warden.', 'Riot in D-block. Shit\'s flying everywhere.', 'Some asshole shanked the build.'],
  quiet: ['Quiet as solitary. Hell of a fucking stretch.', 'Doing hard time in silence. Seen motherfuckers crack like that.', 'Lights on, nobody home. Shit.'],
  working: ['Grinding like it\'s got a parole hearing Monday.', 'Head down, no bullshit. Smart con.', 'Busy as fuck. Don\'t mess with a man on work detail.', 'Look at that motherfucker go.'],
  idle: ['Done its time. Free as a goddamn bird.', 'Clocked out. Lucky bastard.', 'Sitting in the yard on its ass, soaking up the sun.', 'Lazy son of a bitch. I respect it.'],
  hot: ['Word from the yard, and it ain\'t pretty.', 'Somebody\'s in deep shit. Pass it down the line.', 'Holy shit. Read this.'],
};
const probeCon = h => typeof probeLine === 'function' ? probeLine(PROBE_CON[h] ? h : 'idle', PROBE_CON[h] || PROBE_CON.idle) : pick2(PROBE_CON[h] || PROBE_CON.idle);   // + the big pools in probe-lines.js
const PROBE_HOT = /incident/i;                                                    // sessions the probe reports on as news
const probeLastReply = s => { const L = (s && s.log) || []; for (let i = L.length - 1; i >= 0; i--) if (L[i].kind === 'claude' && L[i].text) return L[i]; return null; };
// text for the bubble: markdown links → their text, URLs pulled out (shown whole, as links), formatting stripped
function probeClean(x) {
  const links = [];
  x = String(x || '').replace(/^#+\s*(.+)\n(?=\s*\S)/gm, '$1: ').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_, t, u) => (links.push(u), t))
    .replace(/https?:\/\/[^\s)\]>"'`]+/g, u => (links.push(u.replace(/[.,;:!?]+$/, '')), ''))
    .replace(/\*\*|__|`|^#+\s*/gm, '').replace(/\s+/g, ' ').replace(/\s+([.,;:])/g, '$1').replace(/[(:]\s*\)?\s*$/, '').trim();
  return { text: x, links: [...new Set(links)] };
}
// clean language (View ▸ Mesh ▸ "Probe swears" unticked): the swear words swapped for mild ones before a line is shown
const PROBE_CLEAN = [[/motherfuck(er|ers|in'|ing)?/gi, 'mother-trucker'], [/son of a bitch/gi, 'son of a gun'], [/goddamn(ed)?/gi, 'gosh-darn'], [/fucking/gi, 'freaking'], [/fuck(ed|er|s)?/gi, 'frick$1'],
  [/bullshit/gi, 'bull'], [/shit(ty|s)?/gi, 'crap'], [/assholes?/gi, 'jerk'], [/bastards?/gi, 'buddy'], [/on its ass/gi, 'on its butt']];
const probeCensor = x => PROBE_CLEAN.reduce((s, [re, r]) => s.replace(re, r), String(x || ''));
const probeCut = (x, k) => x.length > k ? x.slice(0, k - 1).replace(/\s+\S*$/, '') + '…' : x;          // at a word
const probeGist = (x, k) => { let o = ''; for (const z of x.match(/[^.!?。]+[.!?。]*/g) || [x]) { if (o && (o + z).length > k) break; o += z; } return probeCut(o.trim(), k); };   // first sentence or two
const PROBE_SAY_CSS = `
body.simple .probe-say, body.simple .probe-menu, body[data-view="grid"] .probe-say, body[data-view="grid"] .probe-menu { display: none !important; }   /* map not shown: the map stops drawing, so it can not hide them itself */
.probe-say { position: fixed; left: 0; top: 0; z-index: 30; max-width: 220px; box-sizing: border-box; padding: 6px 10px 8px;
  background: rgba(12,14,22,.72); color: #e8ebf4; border: 1px solid rgba(255,255,255,.14); border-radius: 10px; box-shadow: 0 6px 22px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.06);
  -webkit-backdrop-filter: blur(10px) saturate(1.25); backdrop-filter: blur(10px) saturate(1.25);
  font: 500 12px/16px -apple-system, system-ui, sans-serif; white-space: pre-line; overflow-wrap: anywhere; text-align: left;
  user-select: text; -webkit-user-select: text; cursor: text; pointer-events: auto; will-change: transform; }
.probe-say.wide { max-width: 300px; }
.probe-say.lite { max-width: 190px; font-size: 11px; line-height: 15px; }
.probe-say.lite.wide { max-width: 250px; }
.probe-say .ps-h { display: flex; align-items: center; gap: 5px; margin-bottom: 2px; font: 700 10px/14px -apple-system, system-ui, sans-serif; color: var(--c); white-space: nowrap; }
.probe-say .ps-h i { width: 7px; height: 7px; border-radius: 50%; background: var(--c); flex: none; }
.probe-say .ps-l a { display: block; margin-top: 3px; color: #8fb8ff; text-decoration: underline; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.probe-say .ps-l a:hover { color: #c3d8ff; }
.probe-say::before, .probe-say::after { content: ''; position: absolute; left: var(--tx, 50%); width: 0; height: 0; border: solid transparent; pointer-events: none; }
.probe-say::before { bottom: -9px; margin-left: -8px; border-width: 9px 8px 0; border-top-color: rgba(255,255,255,.14); }
.probe-say::after { bottom: -7.5px; margin-left: -7px; border-width: 8px 7px 0; border-top-color: rgba(12,14,22,.86); }
.probe-say.dn::before { bottom: auto; top: -9px; border-width: 0 8px 9px; border-color: transparent transparent rgba(255,255,255,.14); }
.probe-say.dn::after { bottom: auto; top: -7.5px; border-width: 0 7px 8px; border-color: transparent transparent rgba(12,14,22,.86); }
.probe-say.done .ps-t::after { content: ' ▼'; font-size: 8px; color: var(--c); animation: psBlink 1s steps(2) infinite; }
@keyframes psBlink { 50% { opacity: 0; } }
.probe-menu { position: fixed; left: 0; top: 0; z-index: 31; width: 232px; box-sizing: border-box; padding: 4px;
  background: #f6f8ff; color: #1b2140; border: 2px solid #141a33; border-radius: 9px; box-shadow: 0 4px 18px rgba(0,0,0,.5);
  font: 500 12px/16px -apple-system, system-ui, sans-serif; text-align: left; user-select: none; -webkit-user-select: none;
  transform-origin: 0 0; animation: pmPop .14s ease-out; }
@keyframes pmPop { from { transform: scale(.85); opacity: 0; } }
.probe-menu .pm-h { display: flex; align-items: baseline; gap: 6px; padding: 4px 8px 6px; border-bottom: 1px solid #d5dbef; margin-bottom: 3px; }
.probe-menu .pm-h b { font-weight: 700; }
.probe-menu .pm-h span { color: #6a7396; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.probe-menu .pm-list { max-height: 260px; overflow-y: auto; }
/* the class is doubled to beat the app's own body:not(.pixel) button styles */
.probe-menu.probe-menu button { display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 8px; border: 0; border-radius: 6px; background: none;
  color: #1b2140; box-shadow: none; letter-spacing: 0; font: inherit; text-align: left; cursor: pointer; }
.probe-menu.probe-menu button:hover, .probe-menu.probe-menu button:focus-visible { background: #dfe6ff; outline: none; }
.probe-menu.probe-menu button:disabled { color: #a3aac4; cursor: default; background: none; }
.probe-menu.probe-menu button .pm-i { width: 16px; flex: none; text-align: center; color: #2457d6; }
.probe-menu.probe-menu button:disabled .pm-i { color: inherit; }
.probe-menu.probe-menu button .pm-n { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.probe-menu.probe-menu button .pm-k { color: #6a7396; font-size: 11px; flex: none; }
.probe-menu.probe-menu button .pm-d { width: 8px; height: 8px; border-radius: 50%; flex: none; margin: 0 4px; }
.probe-menu hr { border: 0; border-top: 1px solid #d5dbef; margin: 3px 4px; }
.probe-menu.ask { width: 290px; }
.probe-menu .pm-ask { display: flex; gap: 6px; padding: 4px 4px 2px; }
.probe-menu .pm-in { flex: 1; min-width: 0; padding: 6px 8px; border: 1.5px solid #b9c3e6; border-radius: 6px; background: #fff; color: #1b2140;
  font: 500 12px/16px -apple-system, system-ui, sans-serif; outline: none; }
.probe-menu .pm-in:focus { border-color: #2457d6; }
.probe-menu .pm-out { padding: 2px 8px 4px; }
.probe-menu .pm-out:empty { display: none; }
.probe-menu .pm-say { margin: 6px 0 4px; line-height: 17px; }
.probe-menu .pm-say b { font-weight: 700; }
.probe-menu .pm-dots::after { content: '…'; animation: psBlink 1s steps(2) infinite; }
.probe-menu .pm-row { display: flex; gap: 6px; margin-top: 6px; }
.probe-menu.probe-menu .pm-btn { width: auto; flex: 1; justify-content: center; padding: 5px 10px; border-radius: 6px; background: #2457d6; color: #fff; font-weight: 600; }
.probe-menu.probe-menu .pm-btn:hover { background: #1b47b8; }
.probe-menu.probe-menu .pm-btn.no { background: #e3e7f5; color: #1b2140; }
.probe-menu.probe-menu .pm-btn.no:hover { background: #d3d9ee; }
.probe-menu.probe-menu .pm-btn:disabled { opacity: .5; }
.probe-menu.probe-menu .pm-ask .pm-btn { flex: none; }
body .probe-say ::selection, body:not(.pixel) .probe-say ::selection { background: #9ec2ff; color: #0b1430; }   /* the app's pale selection is invisible on white */
`;
// 192 px cells; the grid comes from the image (32 frames = 8×4, 96 frames = 12×8 — 2026-10-24: 3× the angles)
const PROBE_SHEET = { cols: 8, rows: 4, cell: 192, frames: 32 };
const probeImg = new Image();
probeImg.onload = () => { const c = PROBE_SHEET.cell; PROBE_SHEET.cols = Math.round(probeImg.naturalWidth / c); PROBE_SHEET.rows = Math.round(probeImg.naturalHeight / c); PROBE_SHEET.frames = PROBE_SHEET.cols * PROBE_SHEET.rows; };
probeImg.src = (location.protocol === 'file:' ? '' : '/') + 'probe/probe_sheet.png';

Object.assign(Mesh.prototype, {
  probeState() {
    return this.probe || (this.probe = { x: this.hub.x + 300, y: this.hub.y, vx: 0, vy: 0, yaw: 0, mode: 'cruise', until: this.time + 10, pa: 0, hops: 0, flame: [], acc: 0, z: 0, nextLand: this.time + 25 });
  },
  // the spot on top of a bubble where the probe sits
  probePerch(n, S) {
    // hover spot above a bubble / the mother star, high enough for the beam to show
    const R = n.isHub ? this.motherRadius() : this.nodeRadius(n) * (n.gscale ?? 1);
    return { x: n.x, y: n.y - R - S * .6 - Math.max(34, R * (n.isHub ? .55 : .9)), R };
  },
  // a hot session with a reply the probe hasn't reported yet (its newest Claude message in the session log)
  probeHot(P) {
    if (P.mode === 'fly' || P.mode === 'swoop' || P.mode === 'land' || this.time - (P.hotAt ?? -1e9) < 60) return null;
    for (const n of this.nodes.values()) {
      if (n.dying || !PROBE_HOT.test(n.s.name || '')) continue;
      const e = probeLastReply(n.s); if (e && e.t > ((P.hotSeen || {})[n.sid] || 0)) return n;
    }
    return null;
  },
  probeNext(P) {
    const t = this.time;
    if (P.mode === 'land') P.nextLand = t + 75;                               // a scan every 75 s (2026-10-27: was 3 min)
    while (P.queue && P.queue.length) {                                         // a tour you asked for: next stop
      const sid = P.queue.shift(); if (!this.probeFind(sid)) continue;
      P.mode = 'fly'; P.target = sid; P.until = t + 14; P.sw = null; return;
    }
    P.queue = null;
    const hot = this.probeHot(P);
    if (hot) { P.mode = 'fly'; P.target = hot.sid; P.until = t + 14; P.sw = null; P.hotAt = t; return; }
    const live = [...this.nodes.values(), ...(this.portalNodes ? this.portalNodes() : [])].filter(n => !n.dying && (n.gscale ?? 1) > .45);
    if (t >= P.nextLand && P.mode !== 'fly') {
      const sid = !live.length || Math.random() < .25 ? '@hub' : live[Math.random() * live.length | 0].sid;   // 1 in 4: the mother star
      P.mode = 'fly'; P.target = sid; P.until = t + 14; P.sw = Math.random() < .5 ? null : 'pending'; return;
    }
    // otherwise wander: ride the orbit ring, or roam free between random spots
    P.target = null; P.wp = null;
    P.mode = Math.random() < .5 ? 'cruise' : 'roam'; P.until = t + 12 + Math.random() * 14;
    if (P.mode === 'cruise' && this.orbitShape) { const sh = this.orbitShape(); P.pa = Math.atan2((P.y - this.hub.y) / sh.k, P.x - this.hub.x) - (this.sysRot || 0); }   // join the ring where it is
  },
  // a bubble by sid ('@hub' = the mother star, 'grp:…' = a portal's main bubble)
  probeFind(sid) {
    if (sid === '@hub') return { sid, isHub: true, x: this.hub.x, y: this.hub.y, z: .05, vx: 0, vy: 0, s: { name: APP_NAME } };
    const n = sid && (this.nodes.get(sid) || (this.portals && sid.startsWith('grp:') && this.portals.get(sid.slice(4)) && this.portals.get(sid.slice(4)).node));
    return n && !n.dying ? n : null;
  },
  // up from a nap (a session started, or you woke it): a hop, a grumble, back on patrol
  probeWake(P, lines) {
    const t = this.time, was = P.mode; P.napUntil = 0; P.idleSince = t; P.mode = 'cruise'; this.probeNext(P); P.nextLand = Math.max(P.nextLand, t + 20);
    if (was === 'sleep') { P.vy = -150; P.say = { text: pick2(lines), health: 'working', name: 'Probe', t0: t, hold: t + 3.5 }; }
  },
  // a random spot in the orbit plane (inside to a bit beyond the ring), with its depth
  probeWaypoint() {
    const sh = this.orbitShape ? this.orbitShape() : { rx: 300, k: .4 }, B = this.bhGeom && !this.off('mBlackHole') ? this.bhGeom() : null;
    let a, r;
    for (let i = 0; i < 8; i++) {                                                // (out round the ring, not through the star — nor next to the black hole)
      a = Math.random() * 6.283; r = sh.rx * (.78 + Math.random() * .45);
      if (!B || Math.hypot(this.hub.x + Math.cos(a) * r - B.x, this.hub.y + Math.sin(a) * r * sh.k - 18 - B.y) > B.cap * 3) break;
    }
    return { x: this.hub.x + Math.cos(a) * r, y: this.hub.y + Math.sin(a) * r * sh.k - 18, z: Math.sin(a) * Math.min(1, r / sh.rx) };
  },

  // layer 'back' (after the far bubbles) moves it and draws it if it's on the far side; 'front' draws it if it's near
  drawProbe(ctx, dt, layer = 'front') {
    if (!probeImg.complete || !probeImg.naturalWidth || this.compact) return;
    const P = this.probeState();
    if (layer === 'back') this.probeStep(dt);
    if ((P.z < 0) === (layer === 'back') && P.S && P.mode !== 'dead') this.probeBody(ctx, dt);
  },
  probeStep(dt) {
    const t = this.time, P = this.probeState(), base = (this.lite ? 30 : 40) * (1 + .03 * Math.sin(t * 2.1)) * (this.sizeOf ? this.sizeOf('probe') : 1);   // × your size (handles.js)
    const S = base * (1 + .35 * P.z) * (P.gs || 1);                          // perspective: nearer = bigger
    P.flameDir = null; P.thrustOver = null;
    if (this.probeLife && this.probeLife(P, dt, base)) return;              // held / falling in / being rebuilt (probe-life.js)
    const find = sid => this.probeFind(sid);
    let tx, ty, n = find(P.target);
    // pointer on the speech bubble (or tapped on the phone): it stays, and so does the probe if it's scanning
    if (P.say && (this.sayHover || (this.sayPin || 0) > t)) { P.say.out = null; P.say.hold = Math.max(P.say.hold || 0, t + .3); if (P.mode === 'land') P.until = Math.max(P.until, t + .6); }
    // a still pointer that the probe drifts under / out from (desktop; the phone has no hover)
    if (!this.lite && this.cursor.in && !this.drag && !this.spinDrag && !this.pan) {
      const h = this.hitProbe(this.cursor); if (h !== !!this.probeHover) { this.probeHover = h; this.c.style.cursor = h ? 'pointer' : ''; }
    }
    // pointed at, or its menu open: it brakes and waits (its timers don't run) so it's easy to click
    const caught = (this.probeHover || this.pmEl) && (P.mode === 'cruise' || P.mode === 'roam' || P.mode === 'fly' || P.mode === 'park');
    if (caught) { P.until += dt; P.nextLand += dt; }
    if (this.probeHover || this.pmEl) P.idleSince = Math.max(P.idleSince ?? t, t - 290);   // you're with it: no dozing off
    // the ring dragged (system spun / tilted): carry the probe, its velocity and its roam spot round with it, rigidly
    // (landed / asleep / swooping it follows its bubble or the star already)
    if (this.orbitShape) {
      const sh = this.orbitShape(), rot = this.sysRot || 0, k = sh.k;
      if (P.rot0 != null && (rot !== P.rot0 || k !== P.k0) && P.mode !== 'land' && P.mode !== 'sleep' && P.mode !== 'swoop' && !P.grav) {
        const d = rot - P.rot0, c = Math.cos(d), sn = Math.sin(d), hx = this.hub.x, hy = this.hub.y - 18, k0 = P.k0;
        const turn = (x, y) => { const u = x - hx, v = (y - hy) / k0; return [hx + u * c - v * sn, hy + (u * sn + v * c) * k]; };
        [P.x, P.y] = turn(P.x, P.y);
        const vv = P.vy / k0; [P.vx, P.vy] = [P.vx * c - vv * sn, (P.vx * sn + vv * c) * k];
        const zOf = y => Math.max(-1, Math.min(1, (y - hy) / (sh.rx * k)));          // depth from where it sits on the plane
        if (P.wp) { [P.wp.x, P.wp.y] = turn(P.wp.x, P.wp.y); P.wp.z = zOf(P.wp.y); }
        if (P.mode === 'cruise' || P.mode === 'roam') P.z = zOf(P.y);
      }
      P.rot0 = rot; P.k0 = k;
    }
    // nap time: nothing working for 5 minutes → sleep on the mother star; any session working → wake up
    const busy = (this.hub.working || 0) > 0, asleep = P.mode === 'tosleep' || P.mode === 'sleep';
    if (busy || P.idleSince == null) P.idleSince = t;
    if (!busy && !asleep && P.mode !== 'park' && !P.grav && t - P.idleSince > 300) { P.mode = 'tosleep'; P.target = null; P.wp = null; P.queue = null; }
    else if (busy && asleep && !(P.napUntil > t)) this.probeWake(P, ['Huh?! Count time? Oh. Someone\'s working. Back on patrol, damn it.', 'I\'m up, I\'m up! Old habit, I wake at the first door.', 'Wasn\'t sleeping. A con never sleeps.', 'Hell. I was dreaming I was back inside.']);
    if ((P.mode === 'fly' || P.mode === 'land' || P.mode === 'swoop') && (!n || n.dying)) { this.probeNext(P); n = find(P.target); }
    // the mother star's pull (2026-10-27): strays too close and it gets dragged round the star (see probeGrav)
    // (2026-10-27: rarer — only now and then on a close pass, more often the bigger you've made the star; at worst once
    // in 4 minutes; and a bigger star sometimes wins: the probe burns up and the Endurance builds a new one)
    if (!P.grav && !caught && (P.mode === 'cruise' || P.mode === 'roam' || P.mode === 'fly') && P.target !== '@hub' && t > (P.gravCool ?? 60) && this.orbitShape) {
      const MR = this.motherRadius(), dx = P.x - this.hub.x, dy = P.y - this.hub.y, dd = Math.hypot(dx, dy), hs = this.sizeOf ? this.sizeOf('hub') : 1;
      if (dd > MR * 2) P.gravRoll = false;
      const close = dd < MR * 1.4 && Math.abs(P.z) < .45 && !P.gravRoll;
      if (close) P.gravRoll = true;
      if (close && Math.random() < Math.min(.85, .28 * hs)) {
        const k = Math.max(.12, Math.abs(this.orbitShape().k));
        P.grav = { t0: t, a: Math.atan2(dy / k, dx), r0: Math.max(MR * 1.3, Math.min(MR * 2.1, Math.hypot(dx, dy / k))), dir: dx * P.vy - dy * P.vx >= 0 ? 1 : -1, fail: Math.random() < Math.min(.5, .14 * hs) };
        P.say = { text: probeLine('starPull', ['Whoa, whoa! The fucking star\'s got me by the collar!', 'Shit! Caught in the pull! Hold on…', 'Hell no, I ain\'t going back in the hole, motherfucker!']), health: 'error', name: 'Probe', t0: t, hold: t + 3.4 };
      }
    }
    const inGrav = !!P.grav;                                                     // (stays set for this whole frame, even as it breaks free)
    if (inGrav) this.probeGrav(P, dt);
    else if (P.mode === 'tosleep' || P.mode === 'sleep') {
      // docked on the Endurance's hub (endurance.js), small as it's far off; without the station: on top of the mother star
      if (this.endDock && !this.off('mEndurance')) { const d = this.endDock(); tx = d.x; ty = d.y - S * .32; P.tz = .05; P.tg = .5; }
      else { tx = this.hub.x; ty = this.hub.y - this.motherRadius() * .93 - S * .5; P.tz = .05; P.tg = 1; }
      if (P.mode === 'tosleep' && Math.hypot(P.x - tx, P.y - ty) < 14) {   // touched down: a health report, then the nap
        P.mode = 'sleep'; const r = this.probeHubReport(true); P.say = P.last = { ...r, name: APP_NAME, t0: t, hold: t + 3 + r.text.length * .06 };
      }
      if (P.mode === 'sleep') { P.x += (tx - P.x) * Math.min(1, dt * 6); P.y += (ty - P.y) * Math.min(1, dt * 6); P.vx = P.vy = 0; }
    } else if (P.mode === 'park') {
      tx = P.park.x; ty = P.park.y; P.tz = P.park.z; P.tg = 1;                  // "stay here": holds that spot until told otherwise
    } else if (P.mode === 'roam') {
      if (!P.wp || Math.hypot(P.x - P.wp.x, P.y - P.wp.y) < 30) P.wp = this.probeWaypoint();
      tx = P.wp.x; ty = P.wp.y; P.tz = P.wp.z; P.tg = 1;
      if (t > P.until || this.probeHot(P)) this.probeNext(P);
    } else if (P.mode === 'cruise') {
      // along the orbit ring (same ellipse and turn as the sessions' orbits), a little above the line
      if (!caught) P.pa += dt * .32;
      const sh = this.orbitShape ? this.orbitShape() : { rx: 300, k: .4 }, a = P.pa + (this.sysRot || 0);
      tx = this.hub.x + Math.cos(a) * sh.rx; ty = this.hub.y + Math.sin(a) * sh.rx * sh.k - 18; P.tz = Math.sin(a); P.tg = 1;
      if (t > P.until || this.probeHot(P)) this.probeNext(P);
    } else {
      const p = this.probePerch(n, S); tx = p.x; ty = p.y; P.tz = n.z || 0; P.tg = Math.min(1, Math.max(.75, n.gscale ?? 1));
      if (P.mode === 'fly' && P.sw === 'pending') {
        // plan the boomerang in the target's frame (it keeps orbiting): out past it to one side, round, back in
        const ox = P.x - tx, oy = P.y - ty, L0 = Math.hypot(ox, oy) || 1, L = Math.max(230, Math.min(480, L0)), ux = -ox / L0, uy = -oy / L0, sd = Math.random() < .5 ? -1 : 1, nx = -uy * sd, ny = ux * sd;
        P.sw = { o0: { x: ox, y: oy }, o1: { x: ox + ux * L * 1.5 + nx * L * .7, y: oy + uy * L * 1.5 + ny * L * .7 }, o2: { x: ux * L * .55 - nx * L * .8, y: uy * L * .55 - ny * L * .8 }, t0: t, T: 2.6 + L / 260 };
        P.mode = 'swoop'; P.until = t + P.sw.T + 3;
      }
      if (P.mode === 'swoop') {
        const W = P.sw, u = Math.min(1, (t - W.t0) / W.T);   // ease in, slow right down for the flare
        const v = Math.min(1, Math.max(0, u < .5 ? 2 * u * u : 1 - Math.pow(2 - 2 * u, 3) / 2)), a = 1 - v;
        const bx = a * a * a * W.o0.x + 3 * a * a * v * W.o1.x + 3 * a * v * v * W.o2.x, by = a * a * a * W.o0.y + 3 * a * a * v * W.o1.y + 3 * a * v * v * W.o2.y;
        const nx2 = tx + bx, ny2 = ty + by; P.vx = (nx2 - P.x) / Math.max(dt, 1e-3); P.vy = (ny2 - P.y) / Math.max(dt, 1e-3); P.x = nx2; P.y = ny2;
        P.swU = u; if (u >= 1) { P.mode = 'fly'; P.sw = null; P.vx *= .2; P.vy *= .2; }
      }
      const d = Math.hypot(P.x - tx, P.y - ty);
      if (P.mode === 'fly' && d < 14) {
        P.mode = 'land'; const r = this.probeRemark(n); P.scanT0 = t; P.bm = [];
        P.say = P.last = { ...r, name: n.isHub ? APP_NAME : n.isGroup ? n.s.name : (n.s.name || 'session'), t0: t + 1.2, sid: n.sid };   // speaks after the first sweep
        P.until = t + 1.2 + Math.max(4 + Math.random() * 4, 2.5 + r.text.length * .07);    // long enough to read it
      }
      if (P.mode === 'land') { P.scan = { x: n.x, y: n.y, R: p.R }; P.x += (tx - P.x) * Math.min(1, dt * 8); P.y += (ty - P.y) * Math.min(1, dt * 8); P.vx = n.vx || 0; P.vy = n.vy || 0; if (t > P.until) { P.vy = -120; this.probeNext(P); } }   // rides along; takes off with a hop
      else if (t > P.until) this.probeNext(P);
    }
    if (!inGrav && P.mode !== 'land' && P.mode !== 'sleep' && P.mode !== 'swoop') {
      // steer: spring toward the target with a speed cap, slowing in for a landing
      const k = P.mode === 'fly' || P.mode === 'tosleep' ? 2.2 : P.mode === 'roam' ? .9 : 1.4, ax = (tx - P.x) * k - P.vx * 1.5, ay = (ty - P.y) * k - P.vy * 1.5;
      if (caught && P.mode !== 'park') { const b = Math.pow(.02, dt); P.vx *= b; P.vy *= b; }        // caught: coast to a stop
      else { P.vx += ax * dt; P.vy += ay * dt; }
      // it gives the black hole a wide berth (only an accident — or you — puts it in)
      if (this.bhGeom && !this.off('mBlackHole')) {
        const B = this.bhGeom(), dx = P.x - B.x, dy = P.y - B.y, d = Math.hypot(dx, dy) || 1, R0 = B.cap * 2.2;
        if (d < R0) { const push = (R0 - d) / R0 * 3200 * dt; P.vx += dx / d * push; P.vy += dy / d * push; }
      }
      const sp = Math.hypot(P.vx, P.vy), max = P.mode === 'fly' || P.mode === 'tosleep' ? 230 : P.mode === 'roam' ? 130 : 150; if (sp > max) { P.vx *= max / sp; P.vy *= max / sp; }
      P.x += P.vx * dt; P.y += P.vy * dt;
    }
    // bank into turns (the sprite rolls with the turn rate), level again when straight or landed
    { const hd = Math.atan2(P.vy, P.vx), spd = Math.hypot(P.vx, P.vy); let w = 0;
      if (spd > 20 && P.hd != null) { w = hd - P.hd; w = Math.atan2(Math.sin(w), Math.cos(w)) / Math.max(dt, 1e-3); }
      P.hd = spd > 20 ? hd : P.hd; const want = Math.max(-.6, Math.min(.6, w * (P.mode === 'swoop' ? .3 : .15)));
      P.bank = (P.bank || 0) + (want - (P.bank || 0)) * Math.min(1, dt * 5); }
    const turning = t - (this.sysTurnAt ?? -9) < .25;                           // the system being spun: depth keeps up with the position (bubbles.js does the same)
    P.z += ((P.tz ?? 0) - P.z) * (turning ? 1 : Math.min(1, dt * (P.mode === 'land' ? 6 : 2.5)));   // depth eases (it flies "into" the far side)
    P.gs = (P.gs || 1) + ((P.tg || 1) - (P.gs || 1)) * Math.min(1, dt * 3);
    if (P.say && P.mode !== 'land' && !P.say.out && !(P.say.hold > t)) P.say.out = t;               // took off: the bubble fades away
    if (P.say && P.say.out && t - P.say.out > .45) P.say = null;
    const still = P.mode === 'land' || P.mode === 'sleep', sp = still ? 0 : Math.hypot(P.vx, P.vy);
    // face the way it flies (frame 0 = toward the camera = moving down the screen); landed: turn to face you
    const want = still ? 0 : Math.atan2(P.vx, P.vy);
    if (sp > 8 || still) { let d = want - P.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); P.yaw += d * Math.min(1, dt * (still ? 2 : 4)); }
    const bob = P.mode === 'sleep' ? Math.sin(t * 1.1) * 1.6 : P.mode === 'land' ? Math.sin(t * 2.2) * 2.2 : Math.sin(t * 1.7) * 3;
    P.S = S; P.dx = P.x; P.dy = P.y + bob; P.sp = sp * (P.grav ? P.grav.thr : 1);   // in the star's grip the engines sputter
  },
  // caught by the mother star: dragged into a tightening, quickening orbit round it in the orbit plane (behind the star,
  // then in front), tumbling, engines sputtering as it fights; then a full burn spirals it out and it goes back to what
  // it was doing — its job (mode, target, tour) is untouched and its timers wait while it's caught
  probeGrav(P, dt) {
    const G = P.grav, t = this.time, MR = this.motherRadius(), k = this.orbitShape ? this.orbitShape().k : .3, T1 = 2.8, T2 = 1;
    const age = t - G.t0, x0 = P.x, y0 = P.y;
    let r, w;
    if (age < T1) { const u = age / T1, e = u * u * (3 - 2 * u); r = G.r0 + (MR * 1.22 - G.r0) * e; w = 1.5 + 3.6 * u; G.thr = Math.sin(t * 21) > .25 ? 1 : .15; }
    else if (G.fail) { const v = Math.min(1, (age - T1) / T2); r = MR * 1.22 * (1 - v * v * .75); w = 5.1 + 4 * v; G.thr = Math.random() < .5 ? 1.6 : 0; P.gs = P.tg = Math.max(.05, 1 - v); }   // it can't — sinking in
    else { const v = Math.min(1, (age - T1) / T2); r = MR * 1.22 + v * v * MR * 2.4; w = 5.1 * (1 - v) + .6; G.thr = 1.6; }
    G.a += G.dir * w * dt;
    if (age > T1 && G.fail && !G.cried) { G.cried = true; P.say = { text: probeLine('starFail', ['No no no — it\'s got me! Tell the warden I…', 'Can\'t… break… free! Fuck this star!']), health: 'error', name: 'Probe', t0: t, hold: t + 2.5 }; }
    const jit = age < T1 ? Math.sin(t * 37) * 2.2 : 0;                            // shaking in the grip
    P.x = this.hub.x + Math.cos(G.a) * r + jit; P.y = this.hub.y + Math.sin(G.a) * r * k - 18 * Math.min(1, age);
    P.vx = (P.x - x0) / Math.max(dt, 1e-3); P.vy = (P.y - y0) / Math.max(dt, 1e-3);
    P.z = P.tz = Math.sin(G.a) * (k < 0 ? -1 : 1) * .9; P.tg = 1;
    P.until += dt; P.nextLand += dt; if (P.sw && P.sw.t0) P.sw.t0 += dt;           // its job waits
    if (age >= T1 + T2 && G.fail) { this.hub.mass = Math.min(14, (this.hub.mass || 0) + 8); if (this.probeDie) this.probeDie('star'); return; }   // burnt up: a flare on the star
    if (age >= T1 + T2) {
      P.grav = null; P.gravCool = t + 240;
      P.say = { text: probeLine('starEscape', ['Broke out. Twenty years inside taught me a thing or two.', 'Phew. Clean escape. Back to work.', 'Ha! No star\'s holding me, motherfucker. Back on the job.']), health: 'working', name: 'Probe', t0: t, hold: t + 2.6 };
    }
  },
  probeBody(ctx, dt) {
    const P = this.probeState(), S = P.S, x = P.dx, y = P.dy, sp = P.sp;
    ctx.save(); ctx.globalAlpha = .72 + .28 * (1 + P.z) / 2;                    // far side a little dimmer, like the bubbles
    // engine fire: a flickering blast out of the rear while it travels (blue-white core, orange-gold flame), plus embers
    const thrust = P.thrustOver ?? Math.min(1, sp / 160) * (P.mode === 'swoop' ? (P.swU > .8 ? 1.4 : .22) : 1);   // gliding: engines low; the flare: a retro-burst
    const bx = P.flameDir ? P.flameDir[0] : sp > 1 ? -P.vx / sp : 0, by = P.flameDir ? P.flameDir[1] : sp > 1 ? -P.vy / sp : 1;   // held: blasting back at you
    if (thrust > .05 && !this.off('mProbe')) {
      P.acc += dt * 90 * thrust;
      while (P.acc >= 1) { P.acc--; P.flame.push({ x: x + bx * S * .55, y: y + by * S * .55, vx: bx * (140 + Math.random() * 120) + (Math.random() - .5) * 50 + P.vx * .3, vy: by * (140 + Math.random() * 120) + (Math.random() - .5) * 50 + P.vy * .3, life: 1, d: .25 + Math.random() * .3 }); }
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const L = S * (1.1 + 1.4 * thrust) * (.85 + .3 * Math.random());                // the plume, flickering
      for (let i = 5; i >= 0; i--) {
        const u = i / 5, px = x + bx * (S * .45 + L * u), py = y + by * (S * .45 + L * u), r = S * (.42 - .3 * u) * (1 + .15 * Math.random());
        ctx.globalAlpha = (1 - u * .7) * (.55 + .45 * thrust);
        ctx.drawImage(glowSprite(u < .2 ? '#e8f8ff' : u < .45 ? '#ffd27a' : '#ff6a1a'), px - r * 2, py - r * 2, r * 4, r * 4);
      }
      ctx.restore();
    }
    if (P.flame.length) {
      const B = [new Path2D(), new Path2D()];
      P.flame = P.flame.filter(f => { f.life -= dt / f.d; if (f.life <= 0) return false; f.vx *= Math.pow(.2, dt); f.vy *= Math.pow(.2, dt); f.x += f.vx * dt; f.y += f.vy * dt; const b = B[f.life > .5 ? 0 : 1]; b.moveTo(f.x, f.y); b.lineTo(f.x - f.vx * .02, f.y - f.vy * .02); return true; });
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,220,140,.85)'; ctx.stroke(B[0]); ctx.strokeStyle = 'rgba(255,110,40,.6)'; ctx.stroke(B[1]); ctx.restore();
    }
    if (P.mode === 'land' && P.scan) this.probeBeam(ctx, dt, P, x, y, S);       // scanning: the tractor beam, under the droid
    const F = PROBE_SHEET, f = ((Math.round(P.yaw / (2 * Math.PI) * F.frames) % F.frames) + F.frames) % F.frames;
    if (this.probeHover || this.pmEl) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .35; ctx.drawImage(glowSprite('#ffffff'), x - S * 1.3, y - S * 1.3, S * 2.6, S * 2.6); ctx.restore(); }
    ctx.translate(x, y); ctx.rotate(P.bank || 0);
    if (P.hue) ctx.filter = `hue-rotate(${Math.round(P.hue)}deg)`;               // a rebuilt probe's paint job (probe-life.js)
    ctx.drawImage(probeImg, (f % F.cols) * F.cell, Math.floor(f / F.cols) * F.cell, F.cell, F.cell, -S, -S, 2 * S, 2 * S);
    ctx.filter = 'none';
    if (this.probeHover || this.pmEl) { ctx.globalAlpha = .45; ctx.drawImage(this.probeSheen(f), -S, -S, 2 * S, 2 * S); }   // pointed at: a white sheen
    ctx.restore();
  },
  // what the probe says about the bubble it landed on: real news first, else "healthy", else a joke about the session
  // … always followed by its own two cents, ex-con style (2026-10-27; it used to swear one time in five)
  probeRemark(n) {
    if (n.isHub) return this.probeHubReport(false);
    const r = this.probeRemarkBase(n), s = n.s || {};
    if (r.work || r.hot) return { ...r, text: r.text + '\n' + probeCon(r.health) };      // the facts, then its two cents
    const dur = sec => sec < 5400 ? Math.max(1, Math.round(sec / 60)) + ' min' : Math.round(sec / 3600) + ' h';
    const lines = {                                                               // nothing in the log: just the yard talk
      waiting: ['Goddamn it, it\'s still waiting on you. Answer the fucking thing!', 'How long we keeping this poor bastard at the bars, huh?'],
      error: ['Oh shit, errors. That\'s a write-up.', 'Fuck. Somebody shanked the build.', 'Well, shit. Lockdown in here, motherfucker.'],
      quiet: [`What the hell is it doing? Silent for ${dur(s.sinceWrite || 0)}. Solitary does that.`, 'Fuck, this one\'s stuck or praying.'],
      working: ['Busy as fuck. Don\'t touch anything.', 'Work detail. Holy shit, look at it go.'],
      idle: n.isGroup ? ['Hell of a crew you\'ve got here. Reminds me of my old cell block.', 'Damn quiet portal. Quiet like the night before a transfer.']
        : ['Damn, it\'s quiet. Like count time.', `Holy crap, $${(s.todayUsd || 0).toFixed(2)} today. In my day that was a year of commissary.`, 'Twenty years inside, and now I babysit fucking bubbles. Hell of a parole.'],
    };
    const h = lines[r.health] ? r.health : 'idle';
    return { text: typeof probeLine === 'function' ? probeLine(h, lines[h]) : pick2(lines[h]), health: r.health };
  },
  probeRemarkBase(n) {
    if (!n.isGroup && PROBE_HOT.test((n.s || {}).name || '')) {
      const e = probeLastReply(n.s);
      if (e) {
        const P = this.probeState(); (P.hotSeen || (P.hotSeen = {}))[n.sid] = e.t;
        const c = probeClean(e.text), ago = Math.max(0, Math.round((Date.now() - e.t) / 60000));
        return { text: `Incident update${ago ? ` (${ago} min ago)` : ''}: ${probeGist(c.text, 170)}`, links: c.links.slice(0, 2), health: n.s.health === 'waiting' ? 'waiting' : 'hot', hot: true };
      }
    }
    { const w = n.isGroup ? this.probeGroupWork(n) : this.probeWork(n.s); if (w) return w; }   // the latest work, when the log has any
    const s = n.s || {}, pick = a => a[Math.random() * a.length | 0];
    const nm = x => { x = String(x || 'this one'); return x.length > 22 ? x.slice(0, 21) + '…' : x; };
    const dur = sec => sec < 90 ? Math.round(sec) + ' s' : sec < 5400 ? Math.round(sec / 60) + ' min' : sec < 172800 ? Math.round(sec / 3600) + ' h' : Math.round(sec / 86400) + ' days';
    const tok = v => v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'k' : String(Math.round(v || 0));
    if (n.isGroup) {
      const m = n.members || [], of = h => m.filter(x => x.s && x.s.health === h), wt = of('waiting'), er = of('error'), wk = of('working');
      if (wt.length) return { text: `${wt.length} in here ${wt.length > 1 ? 'are' : 'is'} waiting for you. ${nm(wt[0].s.name)} first?`, health: 'waiting' };
      if (er.length) return { text: `${nm(er[0].s.name)} is throwing errors. The rest of the group is fine.`, health: 'error' };
      if (wk.length) return { text: `${wk.length} of ${m.length} busy. The portal is humming.`, health: 'working' };
      return { text: pick([`${m.length} sessions, one portal, zero arguments. Nice group.`, `All quiet in ${nm(s.name)}. Even the sparks are napping.`, `Group check: everyone's here, nobody's on fire.`, `I'd join this group, but I'm more of a solo droid.`]), health: 'idle' };
    }
    const h = s.health, pct = s.ctx && s.ctxMax ? Math.round(s.ctx / s.ctxMax * 100) : 0, quiet = s.sinceWrite || 0;
    if (h === 'waiting') return { text: pick(['Waiting for your answer. It looks hopeful.', 'Needs you: there\'s a question on the screen.', 'Paused for your OK. Tap in when you can.']), health: h };
    if (h === 'error') return { text: `${s.errors5m || 'Some'} error${s.errors5m === 1 ? '' : 's'} in the last 5 min.` + (s.lastError ? ` "${String(s.lastError).slice(0, 48)}"` : ' Worth a look.'), health: h };
    if (h === 'quiet') return { text: `Busy but silent for ${dur(quiet)}. Stuck, or thinking very hard?`, health: h };
    if (pct >= 85) return { text: `Context is ${pct}% full. Time to compact soon.`, health: 'quiet' };
    if (h === 'working') {
      if (s.subagents) return { text: `Working, with ${s.subagents} sub-agent${s.subagents > 1 ? 's' : ''} out on errands.`, health: h };
      return { text: pick([s.tps >= 1 ? `Hard at work: ${Math.round(s.tps)} tokens a second.` : `Hard at work. Heads down.`, `Busy and healthy. Don't distract it (I'll be quick).`, `Writing away. ${tok(s.todayTok)} tokens so far today.`]), health: h };
    }
    if (Math.random() < .35) return { text: pick([`Healthy. Idle for ${dur(quiet)}, ready when you are.`, `All good here. Context ${pct}% used.`, `No errors, no questions. A model citizen.`]), health: 'idle' };
    const dir = String(s.cwd || '').split('/').filter(Boolean).pop() || 'home', fam = s.family && s.family !== 'portal' ? s.family : 'Claude';
    return { text: pick([
      `${s.turns || 0} turns and still not dizzy.`,
      `${tok(s.totalTok)} tokens in. That's a lot of words for "done".`,
      `Idle in ${dir}/. I'll keep the seat warm.`,
      `${fam} is thinking about thinking.`,
      `I asked it for a joke. It's still compiling.`,
      `Spent $${(s.todayUsd || 0).toFixed(2)} today. Worth every token, probably.`,
      `Quiet for ${dur(quiet)}. Either done, or plotting.`,
      `Context ${pct}% used. Plenty of room for my opinions.`,
      `It's been up ${String(s.etime || 'a while').replace(/^0?0?-?/, '')}. I've been up since my last render.`,
    ]), health: 'joke' };
  },

  // the tractor beam: powers on growing down from the probe, swallows the bubble, retracts before take-off
  probeBeam(ctx, dt, P, x, y, S) {
    const t = this.time, C = P.scan, age = t - P.scanT0, R = C.R;
    const L = Math.min(1, age / .3, Math.max(0, (P.until - t) / .4)); if (L <= 0) return;   // length: grow / retract
    const scanning = age < 1.2, k = scanning ? 1 : .72;                           // brighter during the first sweep
    const ya = y + S * .42, yb = C.y + R * .6, yE = ya + (yb - ya) * L, Wa = S * .55, wE = Wa + (Math.max(R * 2.3, S * 1.7) - Wa) * L;   // small bubbles still get a proper cone
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const cone = (f, a) => {                                                      // one layer of the cone, f = width share
      const g = ctx.createLinearGradient(0, ya, 0, yE);
      g.addColorStop(0, `rgba(225,255,255,${a})`); g.addColorStop(.55, `rgba(95,235,245,${a * .55})`); g.addColorStop(1, `rgba(50,215,235,${a * .22})`);
      ctx.fillStyle = g; ctx.beginPath();
      ctx.moveTo(x - Wa * f / 2, ya); ctx.lineTo(x + Wa * f / 2, ya); ctx.lineTo(x + wE * f / 2, yE); ctx.lineTo(x - wE * f / 2, yE); ctx.closePath(); ctx.fill();
    };
    const fl = .9 + .1 * Math.sin(t * 23) * Math.sin(t * 7);                    // a faint power flicker
    cone(1, .2 * k * fl); cone(.62, .24 * k * fl); cone(.26, .42 * k * fl);      // soft edges, hot core
    // light streaks down the beam, each breathing on its own
    ctx.lineWidth = 1.2; ctx.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const r = (i + .5) / 7 - .5, a = .32 * k * (.45 + .55 * Math.sin(t * 2.6 + i * 1.9)) * L;
      if (a <= .02) continue;
      ctx.strokeStyle = `rgba(215,255,255,${a})`; ctx.beginPath(); ctx.moveTo(x + Wa * r * .8, ya); ctx.lineTo(x + wE * r * .92, yE); ctx.stroke();
    }
    // the bubble lit from inside, and the glow pooling where the beam ends
    ctx.globalAlpha = .32 * k * L; ctx.drawImage(glowSprite('#7ff4ff'), C.x - R * 1.6, C.y - R * 1.6, R * 3.2, R * 3.2);
    ctx.globalAlpha = .4 * k * L; ctx.drawImage(glowSprite('#bffcff'), x - wE * .55, yE - wE * .13, wE * 1.1, wE * .26);
    // motes lifted out of the bubble, drifting up into the probe
    if (L >= 1) { P.bmAcc = (P.bmAcc || 0) + dt * (this.lite ? 14 : 30) * k; while (P.bmAcc >= 1) { P.bmAcc--; P.bm.push({ u: 0, o: Math.random() * 2 - 1, sp: .45 + Math.random() * .5, z: .8 + Math.random() * 1.4 }); } }
    ctx.globalAlpha = 1; ctx.fillStyle = '#e6ffff';
    P.bm = P.bm.filter(m => {
      m.u += dt * m.sp; if (m.u >= 1) return false;
      const yy = yE + (ya - yE) * m.u, hw = (wE + (Wa - wE) * m.u) / 2 * .8, xx = x + hw * m.o + Math.sin(t * 3 + m.o * 9) * 2;
      ctx.globalAlpha = Math.sin(m.u * Math.PI) * .85 * L; ctx.fillRect(xx - m.z / 2, yy - m.z / 2, m.z, m.z); return true;
    });
    // the scan ring: sweeps down and up over the sphere, sized to its cross-section (fast while scanning, lazy after)
    if (L >= 1) {
      const ph = scanning ? age * 5.2 : 1.2 * 5.2 + (age - 1.2) * 1.6, dy = -Math.cos(ph) * R * .9, w = Math.sqrt(Math.max(0, R * R - dy * dy));
      ctx.globalAlpha = (scanning ? .9 : .45); ctx.strokeStyle = '#b8fdff'; ctx.lineWidth = 1.6; ctx.shadowColor = '#5ff0ff'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.ellipse(C.x, C.y + dy, w * 1.04, w * .28, 0, 0, 6.283); ctx.stroke();
    }
    ctx.restore();
    // the emitter under the droid
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (.55 + .25 * Math.sin(t * 9)) * L;
    ctx.drawImage(glowSprite('#dfffff'), x - S * .5, ya - S * .3, S, S * .6); ctx.restore();
  },

  // the status quo of a session, in one or two lines: its state + the one fact that matters
  //   waiting → the question it's asking you · error → the error · working / silent → the task it's on · idle → what it finished
  probeWork(s) {
    const L = (s && s.log) || []; if (!L.length) return null;
    let i = L.length - 1; while (i > 0 && L[i].kind !== 'you') i--;
    const task = L[i].kind === 'you' ? L[i] : null, run = L.slice(task ? i + 1 : 0);
    let said = null; for (const e of run) if (e.kind === 'claude') said = e;
    const dur = sec => sec < 90 ? Math.round(sec) + ' s' : sec < 5400 ? Math.round(sec / 60) + ' min' : sec < 172800 ? Math.round(sec / 3600) + ' h' : Math.round(sec / 86400) + ' days';
    const on = task ? probeCut(probeClean(task.text).text.split(/\n|[.?!](?:\s|$)/)[0]               // your prompt's first clause, minus filler
      .replace(/^((and|also|so|ok(ay)?|now|then|please|pls|hey|can you|could you|i want( you)? to|let'?s)[,\s]+)+/i, '').replace(/^./, c => c.toUpperCase()), 64) : '';
    const msg = said ? probeClean(said.text) : { text: '', links: [] }, last = L[L.length - 1], since = (Date.now() - last.t) / 1000;
    const h = s.health, pct = s.ctx && s.ctxMax ? Math.round(s.ctx / s.ctxMax * 100) : 0;
    let head, body = on;
    if (h === 'waiting') { const q = (msg.text.match(/[^.!?]*\?/g) || []).pop(); head = 'Waiting for you'; body = q ? probeCut(q.trim(), 110) : on; }
    else if (h === 'error') { head = `${s.errors5m || 'Some'} error${s.errors5m === 1 ? '' : 's'} in 5 min`; body = s.lastError ? probeCut(String(s.lastError), 80) : on; }
    else if (h === 'quiet') head = `Silent ${dur(s.sinceWrite || since)} mid-task`;
    else if (h === 'working') head = s.subagents ? `Working, ${s.subagents} sub-agent${s.subagents > 1 ? 's' : ''} out` : 'Working';
    else head = said ? `Done ${dur(since)} ago` : `Idle ${dur(s.sinceWrite || since)}`;
    return { text: head + (body ? `: ${body}` : '.') + (pct >= 85 ? `\nContext ${pct}% full.` : ''), links: msg.links.slice(0, 2),
      health: h === 'waiting' || h === 'error' || h === 'quiet' || h === 'working' ? h : 'idle', work: true };
  },
  // a portal: the member that did something most recently (and how many others wait for you)
  probeGroupWork(n) {
    const m = (n.members || []).filter(x => x.s && (x.s.log || []).length);
    if (!m.length) return null;
    const x = m.reduce((a, b) => (b.s.log[b.s.log.length - 1].t > a.s.log[a.s.log.length - 1].t ? b : a)), w = this.probeWork(x.s);
    if (!w) return null;
    const nm = String(x.s.name || 'one'), wt = (n.members || []).filter(y => y.s && y.s.health === 'waiting' && y !== x).length;
    return { ...w, text: `${nm.length > 22 ? nm.slice(0, 21) + '…' : nm}: ${w.text}` + (wt ? `\n+${wt} more waiting for you.` : ''), health: wt ? 'waiting' : w.health };
  },
  // landed on the mother star: how Claude Code (all sessions, spend, plan limits) and Mesh itself are doing
  probeHubReport(sleepy) {
    const S = [...this.nodes.values()].filter(n => !n.dying).map(n => n.s), c = h => S.filter(s => s.health === h).length, H = this.hub;
    const wk = c('working'), wt = c('waiting'), er = c('error'), qt = c('quiet');
    const tok = v => v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'k' : String(Math.round(v || 0));
    const lim = (H.usage && H.usage.limits) || [], tight = lim.some(l => l.used >= 90);
    const left = l => `${Math.max(0, Math.round(100 - l.used))}% left`, ses = lim.find(l => l.kind === 'session'), week = lim.find(l => l.kind === 'weekly_all');
    const verdict = er ? 'Claude Code needs a look' : wt ? 'Healthy, but waiting on you' : tight ? 'Healthy, but limits are tight' : qt ? 'Mostly healthy' : 'All healthy';
    const st = [wk && `${wk} working`, wt && `${wt} waiting`, er && `${er} with errors`, qt && `${qt} silent`].filter(Boolean);
    let text = `${verdict}. ${S.length} session${S.length === 1 ? '' : 's'}${st.length ? ': ' + st.join(', ') : ', all idle'}. Today $${(H.usd || 0).toFixed(2)}, ${tok(H.tok)} tokens.`;
    const inT = ms => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
    if (ses || week) text += ' Plan: ' + [ses && `5h ${left(ses)}${ses.resetsAt > Date.now() ? ` (resets in ${inT(ses.resetsAt - Date.now())})` : ''}`, week && `week ${left(week)}`].filter(Boolean).join(', ') + '.';
    const fps = this.fpsM && this.fpsM.v, pr = H.peer;
    const mesh = [fps && `${fps} fps`, pr && pr.label && `${pr.label} ${pr.online ? 'linked' : 'offline'}`].filter(Boolean);
    if (mesh.length) text += ` ${APP_NAME}: ${mesh.join(', ')}.`;
    if (sleepy) text += ' Nothing running. Lights out, I\'m taking a nap. After twenty years in a cell, this bunk is the damn Ritz.';
    else text += '\n' + probeLine('hubTail', ['That\'s the yard report. Nobody\'s rioting. Yet.', 'Count\'s done. Every last son of a bitch accounted for.', 'Yard\'s clear. Smells like trouble anyway.']);
    return { text, health: er ? 'error' : wt || tight || (pr && pr.label && !pr.online) ? 'waiting' : wk ? 'working' : 'idle', wide: true };
  },

  // asleep: little z's drift up and to the right from its head, growing and fading
  probeZzz(ctx, P) {
    const t = this.time; ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < 3; i++) {
      const u = ((t * .45 + i / 3) % 1), x = P.dx + P.S * (.35 + u * .9), y = P.dy - P.S * (.7 + u * 1.5);
      ctx.globalAlpha = Math.sin(u * Math.PI) * .9; ctx.fillStyle = '#cfe6ff';
      ctx.font = `700 ${Math.round(9 + u * 9)}px -apple-system, system-ui, sans-serif`; ctx.fillText('z', x + Math.sin(t * 2 + i) * 3, y);
    }
    ctx.restore();
  },

  // game-style speech bubble over the probe — an HTML element over the canvas, so it can be selected, copied and
  // clicked: pops in, types the line out (links appear once it's done), fades when the probe takes off.
  // While the pointer is on it, it stays where it is (probeStep keeps the probe scanning too).
  probeSayEl() {
    if (this.sayEl) return this.sayEl;
    if (!document.getElementById('probeSayCss')) { const st = document.createElement('style'); st.id = 'probeSayCss'; st.textContent = PROBE_SAY_CSS; document.head.appendChild(st); }
    const el = this.sayEl = document.createElement('div'); el.className = 'probe-say'; el.style.display = 'none';
    el.innerHTML = '<div class="ps-h"><i></i><b></b></div><div class="ps-t"></div><div class="ps-l"></div>';
    this.c.parentElement.appendChild(el);
    el.addEventListener('mouseenter', () => { this.sayHover = true; });
    el.addEventListener('mouseleave', () => { this.sayHover = false; });
    el.addEventListener('pointerdown', e => { e.stopPropagation(); if (e.pointerType !== 'mouse') this.sayPin = this.time + 10; });   // phone: a tap holds it 10 s
    el.addEventListener('click', e => {                                         // iPhone app: hand links to Safari (the web view opens no new windows)
      const a = e.target.closest && e.target.closest('a'); if (!a || !/iPhone|iPad/.test(navigator.userAgent)) return;
      e.preventDefault(); location.href = 'x-safari-' + a.href;
    });
    return el;
  },
  drawProbeSay(ctx) {
    const P = this.probe, B = P && P.say;
    if (P && P.mode === 'sleep' && P.S && !this.compact && !B) this.probeZzz(ctx, P);
    const el = this.sayEl, t = this.time, age = B ? t - B.t0 : 0, out = B && B.out ? Math.max(0, 1 - (t - B.out) / .45) : 1;
    if (!B || !P.S || this.compact || age < 0 || out <= 0 || !this.c.offsetWidth) { if (el && el.style.display !== 'none') { el.style.display = 'none'; this.sayHover = false; } return; }
    const E = this.probeSayEl(), col = { waiting: '#e0a400', error: '#e0475b', quiet: '#e0a400', working: '#16b980', idle: '#6c78b0', joke: '#9a5cff', hot: '#ff4d2e' }[B.health] || '#6c78b0';
    if (this.sayB !== B) {                                                     // a new line: reset the element
      this.sayB = B; B.n = -1; if (this.off('mCuss') && B.text) B.text = probeCensor(B.text);
      E.style.display = ''; E.style.setProperty('--c', col); E.classList.toggle('wide', !!(B.hot || B.wide || (B.links && B.links.length)));
      E.classList.toggle('lite', !!this.lite); E.classList.remove('done');
      E.querySelector('b').textContent = B.name.length > 30 ? B.name.slice(0, 29) + '…' : B.name;
      E.querySelector('.ps-l').innerHTML = '';
    }
    E.style.display = '';
    const n = Math.min(B.text.length, Math.floor(Math.max(0, age - .15) * 45));   // typed out ≈45 characters a second
    if (n !== B.n) {
      B.n = n; E.querySelector('.ps-t').textContent = B.text.slice(0, n);
      if (n >= B.text.length) {                                               // done: the links, and the blinking ▼
        E.classList.add('done');
        const esc = u => u.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
        E.querySelector('.ps-l').innerHTML = (B.links || []).map(u => `<a href="${esc(u)}" target="_blank" rel="noopener" title="${esc(u)}">${esc(u.replace(/^https?:\/\//, ''))}</a>`).join('');
      }
    }
    E.style.opacity = out;
    if (this.sayHover) return;                                                  // under the pointer: hold still
    // where the probe is on screen (world → canvas CSS px → page)
    const m = ctx.getTransform(), d = this.dpr(), rc = this.c.getBoundingClientRect();
    const at = (x, y) => [rc.left + (m.a * x + m.c * y + m.e) / d, rc.top + (m.b * x + m.d * y + m.f) / d];
    const [hx, hy] = at(P.dx, P.dy - P.S * .95), [, fy] = at(P.dx, P.dy + P.S * .95);
    const w = E.offsetWidth, h = E.offsetHeight, dn = hy - 11 - h < rc.top + 6;   // no room above: hang it below
    const left = Math.max(rc.left + 6, Math.min(rc.right - w - 6, hx - w / 2)), top = dn ? fy + 11 : hy - 11 - h;
    const tx = Math.max(16, Math.min(w - 16, hx - left));
    const pop = age < .22 ? .6 + .4 * Math.sin(age / .22 * Math.PI / 2) * (1 + .12 * Math.sin(age / .22 * Math.PI)) : 1;
    E.classList.toggle('dn', dn); E.style.setProperty('--tx', tx + 'px');
    E.style.transformOrigin = `${tx}px ${dn ? 0 : h}px`;
    E.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px) scale(${pop.toFixed(3)})`;
  },

  // ---- pointing at it and its command menu (2026-10-27) ----
  // one sprite frame as a flat white silhouette, for the hover sheen (cached per frame)
  probeSheen(f) {
    const C = this.sheenC || (this.sheenC = new Map()); let c = C.get(f); if (c) return c;
    const F = PROBE_SHEET; c = document.createElement('canvas'); c.width = c.height = F.cell; const x = c.getContext('2d');
    x.drawImage(probeImg, (f % F.cols) * F.cell, Math.floor(f / F.cols) * F.cell, F.cell, F.cell, 0, 0, F.cell, F.cell);
    x.globalCompositeOperation = 'source-atop'; x.fillStyle = '#fff'; x.fillRect(0, 0, F.cell, F.cell);
    C.set(f, c); return c;
  },
  // is the pointer (world coords) on the probe? a generous radius, it's a moving target
  hitProbe(p) {
    const P = this.probe; if (!P || !P.S || this.compact || !probeImg.complete || this.off('mProbe') || P.mode === 'dead' || P.fall) return false;
    return Math.hypot(p.x - P.dx, p.y - P.dy) < P.S * .8 + (this.lite ? 16 : 6) / this.cam.s;
  },
  // what it's up to, for the menu's header
  probeDoing() {
    const P = this.probeState(), n = this.probeFind(P.target), nm = n ? (n.isHub ? 'the mother star' : n.s.name || 'a session') : '';
    return P.mode === 'sleep' || P.mode === 'tosleep' ? (P.napUntil > this.time ? 'Napping on the Endurance (you said so)' : 'Asleep on the Endurance')
      : P.mode === 'park' ? 'Staying put' : P.mode === 'land' ? 'Scanning ' + nm : (P.mode === 'fly' || P.mode === 'swoop') ? 'Flying to ' + nm
      : P.queue ? 'On a tour' : 'On patrol';
  },
  // send it somewhere now; a list = a tour, one stop after another
  probeGo(sids) {
    const P = this.probeState(), t = this.time; P.idleSince = t; P.napUntil = 0; P.queue = sids.slice(1);
    if (P.mode === 'sleep') P.vy = -150;                                        // hop off the star
    P.mode = 'fly'; P.target = sids[0]; P.until = t + 14; P.sw = null; P.say = null;
  },
  // ---- "Ask me to find…" (2026-10-27): you say what you need, it finds the running session or the installed skill for it
  // (a quick Haiku call through the app — core.js probeMatch — understands paraphrases and Korean; keyword matching on
  // the phone or if that fails). A session: it says so, flies over and opens it. A skill: it starts a new session
  // running that skill with your words. Nothing: "make one?" — Yes starts a session for it (one that builds the skill,
  // if a skill is what you asked for), No ends the conversation.
  async probeAskRun(ask) {
    const el = this.pmEl; if (!el) return;
    const out = el.querySelector('.pm-out'), inp = el.querySelector('.pm-in'), go = el.querySelector('[data-a=askgo]');
    const esc = x => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const say = (html, btns) => { out.innerHTML = `<div class="pm-say">${html}</div>` + (btns ? `<div class="pm-row">${btns}</div>` : ''); };
    inp.disabled = go.disabled = true;
    say(pick2(['Hold on, asking around the yard', 'Checking the cell blocks', 'Lemme ask the guys in the yard']) + '<span class="pm-dots"></span>');
    const live = [...this.nodes.values()].filter(n => !n.dying && n.s).map(n => {
      const L = n.s.log || []; let last = ''; for (let i = L.length - 1; i >= 0; i--) if (L[i].kind === 'you') { last = L[i].text; break; }
      return { sid: n.sid, name: n.s.name || '', cwd: n.s.cwd || '', last };
    });
    let r = window.api && window.api.probeMatch ? await window.api.probeMatch(ask, live).catch(() => null) : null;
    if (!r || !r.ok) r = this.probeLocalMatch(ask, live);
    if (this.pmEl !== el) return;                                               // closed while it was asking
    const close = ms => setTimeout(() => { if (this.pmEl === el) this.probeMenuClose(); }, ms);
    const P = this.probeState();
    if (r.kind === 'session') {
      const n = this.nodes.get(r.id), nm = n && n.s ? n.s.name : 'that one';
      say(`Found it: <b>${esc(nm)}</b>. ${esc(r.why || '')}<br>Opening it up. ${pick2(['Don\'t say I never did shit for you.', 'Easy as a count.', 'Told you I know this joint.'])}`);
      this.probeGo([r.id]); P.idleSince = this.time;
      setTimeout(() => this.onSelect && this.onSelect(r.id), 500); close(2600);
    } else if (r.kind === 'skill') {
      say(`That's your <b>${esc(r.id)}</b> skill. ${esc(r.why || '')}<br>Starting a session on it. ${pick2(['Go get \'em.', 'Damn right I found it, motherfucker.'])}`);
      const ok = await this.probeStartSession(`${r.id} ${ask}`);
      if (!ok) say(`That's your <b>${esc(r.id)}</b> skill, but I can't start sessions from here. Run it on the Mac.`);
      close(ok ? 2600 : 4000);
    } else {
      const skillish = /\bskills?\b|스킬/i.test(ask);
      say(`Never heard of ${skillish ? 'a skill' : 'anything'} like that in this joint. ${esc(r.why ? r.why : '')}<br><b>Want me to make one?</b>`,
        '<button type="button" class="pm-btn" data-a="yes">Yes</button><button type="button" class="pm-btn no" data-a="no">No</button>');
      el.querySelector('[data-a=yes]').onclick = async () => {
        el.querySelectorAll('.pm-row button').forEach(b => b.disabled = true);
        const ok = await this.probeStartSession(skillish ? `Create a new Claude Code skill (in ~/.claude/skills) for this: ${ask}` : ask);
        say(ok ? `On it. Fresh ${skillish ? 'session building that skill' : 'session'} coming up. ${pick2(['Don\'t fuck it up.', 'Hell of a request.'])}` : 'Can\'t start sessions from here. Do it on the Mac.');
        close(ok ? 2400 : 3500);
      };
      el.querySelector('[data-a=no]').onclick = () => { say(pick2(['Alright. Forget I asked.', 'Fine. I never saw nothing.', 'Suit yourself. Back to my rounds.'])); close(1400); };
    }
  },
  // without the app (phone) or if the Haiku call fails: plain keyword overlap with the sessions' names, folders, last asks
  probeLocalMatch(ask, live) {
    const words = x => String(x || '').toLowerCase().split(/[^a-z0-9가-힣]+/).filter(w => w.length > 2);
    const q = new Set(words(ask)); let best = null, bs = 0;
    for (const s of live) { const sc = words(`${s.name} ${s.cwd.split('/').pop()} ${s.last}`).filter(w => q.has(w)).length; if (sc > bs) { bs = sc; best = s; } }
    return bs >= 2 || (best && bs >= 1 && q.size <= 3) ? { ok: true, kind: 'session', id: best.sid, why: '' } : { ok: true, kind: 'none', why: '' };
  },
  // a new Claude session in the app's dock, opened on `prompt` (the app's usual New-session flags and model)
  async probeStartSession(prompt) {
    if (typeof newTerm !== 'function' || !window.api || !window.api.home) return false;
    const home = await window.api.home();
    const o = (typeof store !== 'undefined' && store.get && store.get('newOpts', null)) || {};
    const win = /Win/.test(navigator.platform), q = win ? `'${prompt.replace(/'/g, "''")}'` : `'${prompt.replace(/'/g, "'\\''")}'`;
    const flags = `${o.flags || '--dangerously-skip-permissions --remote-control'}${o.model ? ` --model ${o.model}` : ''} ${q}`;
    await newTerm({ kind: 'claude', cwd: home, flags, title: 'claude · ' + (prompt.length > 28 ? prompt.slice(0, 27) + '…' : prompt) });
    return true;
  },
  probeMenuClose() {
    if (!this.pmEl) return; this.pmEl.remove(); this.pmEl = null;
    removeEventListener('pointerdown', this.pmAway, true); removeEventListener('keydown', this.pmKey, true);
  },
  // the command menu, at the click; `page` 'scan' swaps in the list of bubbles to pick from
  probeMenu(cx, cy, page) {
    this.probeMenuClose(); this.probeSayEl();                                   // (the say bubble injects the CSS)
    const P = this.probeState(), t = this.time, asleep = P.mode === 'sleep' || P.mode === 'tosleep';
    const esc = x => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const rank = { waiting: 0, error: 1, quiet: 2, working: 3 }, dot = { waiting: '#e0a400', error: '#e0475b', quiet: '#e0a400', working: '#16b980' };
    const live = [...this.nodes.values(), ...(this.portalNodes ? this.portalNodes() : [])].filter(n => !n.dying && (n.gscale ?? 1) > .45 && n.s)
      .sort((a, b) => (rank[a.s.health] ?? 4) - (rank[b.s.health] ?? 4) || String(a.s.name).localeCompare(String(b.s.name)));
    const needy = live.filter(n => rank[n.s.health] <= 2);
    const acts = {}, item = (id, icon, label, key, fn, off) => { acts[id] = fn; return `<button data-a="${id}"${off ? ' disabled' : ''}><span class="pm-i">${icon}</span><span class="pm-n">${esc(label)}</span>${key ? `<span class="pm-k">${esc(key)}</span>` : ''}</button>`; };
    let body;
    if (page === 'ask') {
      body = item('back', '‹', 'Back', '', () => this.probeMenu(cx, cy)) + '<hr>'
        + '<div class="pm-ask"><input class="pm-in" type="text" maxlength="500" placeholder="What do you need? A session, a skill…" autocomplete="off" spellcheck="false">'
        + '<button type="button" class="pm-btn" data-a="askgo">Ask</button></div><div class="pm-out"></div>';
      acts.askgo = () => { const i = this.pmEl && this.pmEl.querySelector('.pm-in'); if (i && i.value.trim()) this.probeAskRun(i.value.trim()); };
    } else if (page === 'scan') {
      body = item('back', '‹', 'Back', '', () => this.probeMenu(cx, cy)) + '<hr><div class="pm-list">'
        + item('hub', '✺', 'Mother star (health check)', '', () => this.probeGo(['@hub']))
        + live.map((n, i) => { acts['n' + i] = () => this.probeGo([n.sid]);
            return `<button data-a="n${i}"><span class="pm-d" style="background:${dot[n.s.health] || '#8a93b8'}"></span><span class="pm-n">${esc(n.s.name || 'session')}</span><span class="pm-k">${esc(n.isGroup ? 'portal' : n.s.health || '')}</span></button>`; }).join('')
        + '</div>';
    } else if (page === 'folders') {                                  // a session's project folder → Finder (folder-pods.js)
      const F = window.sessionFolders || {}, withF = live.filter(n => F[n.sid]);
      body = item('back', '‹', 'Back', '', () => this.probeMenu(cx, cy)) + '<hr><div class="pm-list">'
        + (withF.map((n, i) => { const f = F[n.sid]; acts['f' + i] = () => { window.openSessionFolder && window.openSessionFolder(f.path); P.say = { text: `Opened ${f.label} for ${n.s.name}.`, health: 'idle', name: this.probeName ? this.probeName(P) : 'Probe', t0: t, hold: t + 3 }; };
            return `<button data-a="f${i}" title="${esc(f.label)}"><span class="pm-d" style="background:${dot[n.s.health] || '#8a93b8'}"></span><span class="pm-n">${esc(n.s.name || 'session')}</span><span class="pm-k">${esc(f.label.length > 30 ? '…' + f.label.slice(-29) : f.label)}</span></button>`; }).join('')
          || '<div class="pm-empty" style="padding:8px 12px;opacity:.7">No session has a folder of its own yet.</div>')
        + '</div>';
    } else {
      const nFold = live.filter(n => (window.sessionFolders || {})[n.sid]).length;
      body = item('ask', '✎', 'Ask me to find…', 'session / skill', () => this.probeMenu(cx, cy, 'ask'))
        + item('scan', '◎', 'Scan a session…', live.length ? String(live.length) : '', () => this.probeMenu(cx, cy, 'scan'), !live.length)
        + item('folders', '▭', "Open a session's folder…", nFold ? String(nFold) : 'none', () => this.probeMenu(cx, cy, 'folders'), !nFold)
        + item('needy', '⚑', 'Check what needs me', needy.length ? String(needy.length) : 'none', () => this.probeGo(needy.map(n => n.sid)), !needy.length)
        + item('health', '✺', 'Health check', '', () => this.probeGo(['@hub']))
        + item('again', '↻', 'Say the last report again', '', () => { const L = P.last; P.say = { ...L, t0: t, hold: t + 4 + L.text.length * .06, out: null }; }, !P.last)
        + (P.tidy ? item('tidystop', '■', 'Stop tidying up', `${P.tidy.q.done}/${P.tidy.q.jobs.length}`, () => { for (const W of this.probes || [P]) this.tidyStop(W, W === P ? 'Fine, I\'ll leave the rest where they are.' : null); })
          : item('tidy', '⇶', 'Tidy up the bubbles', live.length ? String(live.length) : '', () => this.probeTidy(), !live.length || !this.probeTidy || this.compact))
        + (this.tidyUndo && !P.tidy ? item('untidy', '↶', 'Undo tidy-up', '', () => this.probeTidyUndo()) : '')
        + (this.manualStart ? (P.manual ? item('manual', '✥', 'Release control', 'Esc', () => this.manualStop(P)) : item('manual', '✥', 'Manual control', 'WASD · ⇧ · Space', () => this.manualStart(P), P.mode === 'dead' || !!P.fall)) : '')
        + (this.crewLaunch ? item('crew', '✚', 'Launch a crew probe', `${(this.probes || [P]).length}/3`, () => this.crewLaunch(1), (this.probes || [P]).length >= 3 || this.off('mEndurance'))
          + ((this.probes || []).length > 1 ? item('recall', '⌂', 'Recall the crew', '', () => this.crewRecall()) : '') : '')
        + '<hr>'
        + (P.mode === 'park' ? item('go', '▶', 'Resume patrol', '', () => { P.idleSince = t; this.probeNext(P); })
          : item('stay', '■', 'Stay here', '', () => { P.queue = null; P.target = null; P.mode = 'park'; P.park = { x: P.x, y: P.y, z: P.z }; P.vx *= .2; P.vy *= .2; }, asleep))
        + (asleep ? item('wake', '☀', 'Wake up', '', () => this.probeWake(P, ['Alright, alright, I\'m up. You sound like a damn guard.', 'Five more minutes… fine. Back to work detail.', 'Hell, no rest for the reformed.']))
          : item('nap', '☾', 'Take a nap', '15 min', () => { P.queue = null; P.mode = 'tosleep'; P.target = null; P.wp = null; P.napUntil = t + 900; }));
    }
    const el = this.pmEl = document.createElement('div'); el.className = 'probe-menu' + (page === 'ask' ? ' ask' : '');
    el.innerHTML = `<div class="pm-h"><b>Probe</b><span>${esc(this.probeDoing())}</span></div>${body}`;
    this.c.parentElement.appendChild(el);
    const w = el.offsetWidth, h = el.offsetHeight, rc = this.c.getBoundingClientRect();
    el.style.left = Math.max(rc.left + 6, Math.min(rc.right - w - 6, cx + 8)) + 'px';
    el.style.top = Math.max(rc.top + 6, Math.min(rc.bottom - h - 6, cy + 8)) + 'px';
    el.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || b.disabled) return;
      const id = b.dataset.a; if (!/^(back|scan|ask|askgo|yes|no|folders)$/.test(id)) this.probeMenuClose(); acts[id] && acts[id]();
    });
    el.addEventListener('mouseenter', () => { this.probeHover = false; });
    this.pmAway = e => { if (!el.contains(e.target)) this.probeMenuClose(); };
    this.pmKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); this.probeMenuClose(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const B = [...el.querySelectorAll('button:not(:disabled)')], i = B.indexOf(document.activeElement);
      e.preventDefault(); B[(i + (e.key === 'ArrowDown' ? 1 : B.length - 1 + (i < 0 ? 1 : 0))) % B.length].focus();
    };
    setTimeout(() => { if (this.pmEl === el) addEventListener('pointerdown', this.pmAway, true); });   // not the click that opened it
    addEventListener('keydown', this.pmKey, true);
    const first = el.querySelector('button:not(:disabled)'); if (first && page && page !== 'ask') first.focus({ preventScroll: true });
    const inp = el.querySelector('.pm-in');
    if (inp) {
      inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); acts.askgo(); } else if (e.key === 'Escape') this.probeMenuClose(); });
      setTimeout(() => inp.focus({ preventScroll: true }), 30);
    }
  },
});
