// The sun (2026-11-19): the session that runs this app (main.js markSun → snap.sun) is the mother star itself.
//  • It sits fixed in the middle: its bubble is not drawn, it gets no orbit and no strand to itself; the star grows a
//    little (×1.12) and gets a warm, still halo, with its name, status, last activity and relay count above it.
//  • Click the star: its session opens like any other (right-click, or press-and-hold on the iPhone: the star menu).
//  • Relays (messages between sessions, snap.sessions[].relaysRecent) are drawn as beams, ending at the star for the
//    sun's own messages and for messages the app itself sends. A beam lives 4 s; only then does the mesh animate,
//    otherwise nothing extra runs. Reduced motion: still beams that fade, no travelling light.
// Loaded after mesh.js / mother.js / bubbles.js on both the Mac window and the phone page.
(() => {
  const P = Mesh.prototype, RM = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const wrap = (name, fn) => { const o = P[name]; P[name] = function (...a) { return fn.call(this, o, ...a); }; };
  const SUN = [255, 196, 110], BEAM_S = 4;

  P.sunNode = function () { const n = this.sunSid && this.nodes.get(this.sunSid); return n && !n.dying ? n : null; };
  // run `fn` with the sun's node out of this.nodes (orbit, strands, separation and orbit rings skip it)
  const without = function (orig, ...a) {
    const n = this.sunNode(); if (!n) return orig.apply(this, a);
    this.nodes.delete(n.sid);
    try { return orig.apply(this, a); } finally { this.nodes.set(n.sid, n); n.x = this.hub.x; n.y = this.hub.y; n.vx = n.vy = 0; n.z = 0; }
  };
  wrap('stepSessions', without); wrap('drawLinks', without); wrap('drawSessionOrbits', without);
  wrap('drawMote', function (orig, n, dt) { if (n === this.sunNode()) return; return orig.call(this, n, dt); });
  wrap('hit', function (orig, e) { return without.call(this, orig, e); });
  wrap('motherRadius', function (orig) { const r = orig.call(this); return this.sunNode() ? r * 1.12 : r; });

  wrap('update', function (orig, snap) {
    const was = this.sunSid; this.sunSid = snap.sun || null;
    orig.call(this, snap);
    if (was !== this.sunSid) { this.motherImp = null; this.wake && this.wake(); }
    this.noteRelays(snap);
  });

  // ---- relay beams ----
  P.noteRelays = function (snap) {
    const S = snap.sessions || [], byPid = new Map(S.filter(s => s.pid).map(s => [s.pid, s.sid]));
    const byName = new Map(S.map(s => [String(s.name).toLowerCase(), s.sid]));
    const seen = this.relaySeen || (this.relaySeen = new Map()), now = Date.now(), beams = this.beams || (this.beams = []);
    const who = r => byPid.get(r.pid) || (r.name && byName.get(r.name.toLowerCase())) || null;
    let added = 0;
    for (const s of S) for (const r of s.relaysRecent || []) {
      // each message is seen twice (sent by one, received by the other): draw it from the sender's side, and from the
      // receiver's side only when the sender isn't a live session here (the app itself, a closed or remote session)
      const other = who(r);
      if (r.dir === 'in' && other && (S.find(x => x.sid === other) || {}).relaysRecent?.some(o => o.dir === 'out' && Math.abs(o.t - r.t) < 120e3)) continue;
      const key = s.sid + r.t + r.dir; if (seen.has(key)) continue; seen.set(key, now);
      if (now - r.t > 30e3) continue;                       // older than the page: counted, not drawn
      const from = r.dir === 'out' ? s.sid : other, to = r.dir === 'out' ? other : s.sid;
      beams.push({ from, to, born: this.time }); added++;
    }
    for (const [k, t] of seen) if (now - t > 300e3) seen.delete(k);
    if (beams.length > 24) beams.splice(0, beams.length - 24);
    if (added) this.wakeUntil = Math.max(this.wakeUntil || 0, performance.now() + BEAM_S * 1000 + 200);
    if (added && this.kick) this.kick();
  };
  // a beam end: a session's bubble, or the star (the sun itself, the app, or someone not on the mesh)
  P.beamEnd = function (sid) {
    const n = sid && this.nodes.get(sid);
    return n && !n.dying && n !== this.sunNode() ? { x: n.x, y: n.y, r: this.nodeRadius(n) } : { x: this.hub.x, y: this.hub.y, r: this.motherRadius() };
  };
  P.drawBeams = function (ctx) {
    const B = this.beams; if (!B || !B.length) return;
    const t = this.time; this.beams = B.filter(b => t - b.born < BEAM_S); if (!this.beams.length) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    for (const b of this.beams) {
      const a = this.beamEnd(b.from), z = this.beamEnd(b.to); if (a.x === z.x && a.y === z.y) continue;
      const L = Math.hypot(z.x - a.x, z.y - a.y) || 1, ux = (z.x - a.x) / L, uy = (z.y - a.y) / L;
      const x0 = a.x + ux * a.r, y0 = a.y + uy * a.r, x1 = z.x - ux * z.r, y1 = z.y - uy * z.r;
      const age = (t - b.born) / BEAM_S, fade = age < .1 ? age / .1 : 1 - (age - .1) / .9;
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, `rgba(${SUN},${.15 * fade})`); g.addColorStop(1, `rgba(${SUN},${.85 * fade})`);
      ctx.strokeStyle = g; ctx.globalAlpha = .35; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 1.6; ctx.stroke();
      if (!RM.matches) {                                   // one light travelling from sender to receiver
        const k = Math.min(1, age * 1.6), px = x0 + (x1 - x0) * k, py = y0 + (y1 - y0) * k, sz = 9;
        ctx.globalAlpha = fade; ctx.drawImage(glowSprite('#ffd27a'), px - sz, py - sz, sz * 2, sz * 2);
      }
    }
    ctx.restore();
  };
  wrap('drawMotherInfo', function (orig) {
    this.drawBeams(this.ctx);
    orig.call(this);
    const n = this.sunNode(); if (!n || this.cineClean) return;
    const ctx = this.ctx, h = this.hub, R = this.motherRadius(), s = n.s;
    const ago = Math.min(...[s.sinceUse, s.sinceWrite].filter(v => typeof v === 'number' && v >= 0), 9e9);
    const when = s.health === 'working' ? 'working' : ago < 60 ? 'just now' : ago < 3600 ? Math.round(ago / 60) + ' min ago' : ago < 86400 ? Math.round(ago / 3600) + ' h ago' : Math.round(ago / 86400) + ' d ago';
    const line = `${when}  ·  ${s.relaysToday || 0} relay${s.relaysToday === 1 ? '' : 's'} today`;
    ctx.save(); ctx.textAlign = 'center';
    const y = h.y - R * 1.22 - (this.compact ? 8 : 14);
    ctx.font = `600 ${this.compact ? 11 : 13}px -apple-system, system-ui, sans-serif`; const w1 = ctx.measureText(s.name).width;
    ctx.font = `400 ${this.compact ? 9.5 : 11}px -apple-system, system-ui, sans-serif`; const w2 = ctx.measureText(line).width;
    const W = Math.max(w1, w2) + 22, H = this.compact ? 32 : 38;
    ctx.fillStyle = 'rgba(20,12,4,.72)'; ctx.strokeStyle = `rgba(${SUN},.45)`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(h.x - W / 2, y - H, W, H, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffe2b0'; ctx.font = `600 ${this.compact ? 11 : 13}px -apple-system, system-ui, sans-serif`; ctx.fillText(s.name, h.x, y - H + (this.compact ? 13 : 16));
    ctx.fillStyle = s.health === 'working' ? '#9be3a4' : s.health === 'waiting' ? '#ffcf6b' : s.health === 'error' ? '#ff7a7a' : 'rgba(236,225,205,.75)';
    ctx.font = `400 ${this.compact ? 9.5 : 11}px -apple-system, system-ui, sans-serif`; ctx.fillText(line, h.x, y - (this.compact ? 7 : 9));
    ctx.restore();
  });
  // a warm, still halo around the star (one gradient fill a frame; nothing breathes)
  wrap('drawAttractor', function (orig, dt) {
    if (this.sunNode()) {
      const ctx = this.ctx, h = this.hub, R = this.motherRadius(), work = this.sunNode().s.health === 'working';
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(h.x, h.y, R * .9, h.x, h.y, R * 3);
      g.addColorStop(0, `rgba(${SUN},${work ? .34 : .26})`); g.addColorStop(.35, `rgba(${SUN},${work ? .12 : .09})`); g.addColorStop(1, `rgba(${SUN},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(h.x, h.y, R * 3, 0, 6.29); ctx.fill(); ctx.restore();
    }
    return orig.call(this, dt);
  });
  // a plain click on the star opens the sun's session; right-click (and press-and-hold) keep the star menu
  P.hubClick = function () { return this.sunNode() ? this.onSelect(this.sunSid) : this.onHub(); };
  wrap('down', function (orig, e) {
    const r = orig.call(this, e);
    if (this.hubPress && e.button === 0 && this.sunNode()) {
      const hp = this.hubPress; clearTimeout(this.hubHoldT);
      this.hubHoldT = setTimeout(() => { if (this.hubPress === hp) { this.hubPress = null; this.c.style.cursor = ''; this.onHub(); } }, 520);
    }
    return r;
  });
})();
