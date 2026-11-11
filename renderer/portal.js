// Session groups on the mesh, drawn as Doctor-Strange sling-ring portals (user ask 2026-10-24, reference: the
// burning ring of sparks you step through, and the orange mandala shield). A group's sessions orbit together inside
// one portal: the group is a main bubble named after it, and its sessions ride a ring of fire around it as small
// satellites. The ring draws itself when the group forms, sparks spray off it and fall, a sigil turns behind.
// Collapsing pulls the satellites into the main bubble; clicking the main bubble opens / closes the group.
// Data: snap.groups { id: { name, collapsed } } + session.group (main.js groups.json). Loaded after organism.js.

const PORTAL = { gold: [255, 186, 92], hot: [255, 240, 200], ember: [255, 110, 30] };
const sigilCache = {};
// three pre-drawn sigil layers (rune ring, octagram, hexagram), each turned at its own speed every frame
function sigilSprite(kind) {
  if (sigilCache[kind]) return sigilCache[kind];
  const S = 512, C = S / 2, R = S / 2 - 6, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'), r = rnd(kind === 'runes' ? 7.7 : kind === 'oct' ? 3.1 : 5.3);
  x.strokeStyle = 'rgba(255,170,80,1)'; x.fillStyle = 'rgba(255,190,110,1)'; x.lineCap = 'round'; x.lineJoin = 'round';
  const circle = (rr, w) => { x.lineWidth = w; x.beginPath(); x.arc(C, C, rr, 0, 6.2832); x.stroke(); };
  const poly = (n, rr, rot, w, step = 1) => { x.lineWidth = w; x.beginPath(); for (let i = 0; i <= n; i++) { const a = rot + (i * step % n) / n * 6.2832; i ? x.lineTo(C + Math.cos(a) * rr, C + Math.sin(a) * rr) : x.moveTo(C + Math.cos(a) * rr, C + Math.sin(a) * rr); } x.stroke(); };
  if (kind === 'runes') {
    circle(R * .99, 3); circle(R * .9, 2); circle(R * .78, 2.5);
    for (let i = 0; i < 40; i++) {                                    // little glyphs between the two outer circles
      const a = i / 40 * 6.2832, gx = C + Math.cos(a) * R * .945, gy = C + Math.sin(a) * R * .945;
      x.save(); x.translate(gx, gy); x.rotate(a + Math.PI / 2); x.lineWidth = 2.2; x.beginPath();
      const h = R * .035, w = R * .028, g = r() * 6 | 0;
      if (g === 0) { x.moveTo(-w, -h); x.lineTo(0, h); x.lineTo(w, -h); }
      else if (g === 1) { x.moveTo(-w, 0); x.lineTo(w, 0); x.moveTo(0, -h); x.lineTo(0, h); }
      else if (g === 2) { x.arc(0, 0, h * .8, 0, 6.2832); }
      else if (g === 3) { x.moveTo(-w, h); x.lineTo(-w, -h); x.lineTo(w, -h); x.lineTo(w, h); }
      else if (g === 4) { x.moveTo(-w, -h); x.lineTo(w, h); x.moveTo(w, -h); x.lineTo(-w, h); }
      else { x.moveTo(0, -h); x.lineTo(w, 0); x.lineTo(0, h); x.lineTo(-w, 0); x.closePath(); }
      x.stroke(); x.restore();
    }
    for (let i = 0; i < 24; i++) { const a = i / 24 * 6.2832; x.beginPath(); x.arc(C + Math.cos(a) * R * .72, C + Math.sin(a) * R * .72, 3, 0, 6.2832); x.fill(); }
  } else if (kind === 'oct') {
    poly(4, R * .76, 0, 2.5); poly(4, R * .76, Math.PI / 4, 2.5);         // two squares → octagram
    poly(8, R * .54, Math.PI / 8, 1.6); circle(R * .54, 1.4);
    for (let i = 0; i < 8; i++) { const a = i / 8 * 6.2832; x.lineWidth = 1.2; x.beginPath(); x.moveTo(C, C); x.lineTo(C + Math.cos(a) * R * .76, C + Math.sin(a) * R * .76); x.stroke(); }
  } else {
    poly(3, R * .5, -Math.PI / 2, 2.4); poly(3, R * .5, Math.PI / 2, 2.4);   // hexagram
    circle(R * .5, 1.8); circle(R * .26, 2.2); circle(R * .1, 2);
    for (let i = 0; i < 6; i++) { const a = i / 6 * 6.2832 - Math.PI / 2; x.beginPath(); x.arc(C + Math.cos(a) * R * .38, C + Math.sin(a) * R * .38, R * .045, 0, 6.2832); x.lineWidth = 1.6; x.stroke(); }
  }
  return (sigilCache[kind] = c);
}

Object.assign(Mesh.prototype, {
  portalOf(gid) { const m = this.portals || (this.portals = new Map()); if (!m.has(gid)) m.set(gid, { open: 0, shut: this.gShut(gid) ? 1 : 0, rot: rnd(gid.length)() * 6, sparks: [], acc: 0, x: this.hub.x, y: this.hub.y, R: 40 }); return m.get(gid); },
  // collapsed? (2026-10-29) On the mesh a sling-ring is folded by default, whatever the Sessions list shows; a change to
  // the group opens it for 7 s (P.peekUntil, set in groupPass); a click on the portal opens / closes it by hand.
  gShut(gid) {
    const l = this.gLocal && this.gLocal[gid], P = this.portals && this.portals.get(gid);
    if (P && P.peekUntil > this.time) return false;
    return l ? l.c : true;
  },
  groupFlip(gid, c) { (this.gLocal || (this.gLocal = {}))[gid] = { c, at: this.time }; },
  toggleGroup(gid) { const P = this.portals && this.portals.get(gid); if (P) P.peekUntil = 0; this.groupFlip(gid, !this.gShut(gid)); },
  groupAnchor(sid) {
    if (sid.startsWith('grp:')) { const P = this.portals && this.portals.get(sid.slice(4)); return P && P.members ? P.members[0].sid : sid; }
    const n = this.nodes.get(sid), P = n && n.s.group && this.portals && this.portals.get(n.s.group); return P && P.members && P.shut < .5 ? P.members[0].sid : sid;
  },

  // before the sessions move: each group becomes a main bubble (named after the group, gold "portal" palette) riding
  // its first member's orbit; its sessions ride the burning sling-ring around it as small satellites. Collapsing
  // pulls the satellites into the main bubble. Sets n.gslot (where a member goes) and n.gscale (its size).
  // A sub-session (started by a session, or a nameless run of its project) is a small satellite of its main session
  // instead of a bubble of its own. Same slot and scale a group member uses, so clicks, the sessions list and everything
  // else keep working; it shows its name when you point at it or select it.
  moonPass(live, G, dt) {
    const by = new Map();
    const root = n => { let p = this.nodes.get(n.s.parent); for (let i = 0; p && p.s && p.s.parent && this.nodes.get(p.s.parent) && i < 4; i++) p = this.nodes.get(p.s.parent); return p; };
    for (const n of live) {
      n.moon = false; if (!n.s.parent || n.eaten || n.dragging || (n.s.group && G[n.s.group])) continue;
      const P = root(n); if (!P || P === n || P.dying || P.eaten) continue;
      n.moon = true; if (!by.has(P)) by.set(P, []); by.get(P).push(n);
    }
    for (const [P, kids] of by) {
      kids.sort((a, b) => (a.sid < b.sid ? -1 : 1));
      const base = this.nodeRadius(P) * (P.gscale ?? 1), dir = P.seed > .5 ? 1 : -1;
      kids.forEach((n, i) => {
        const ring = i < 6 ? 0 : i < 16 ? 1 : 2, first = [0, 6, 16][ring], size = ring === 2 ? Math.max(1, kids.length - 16) : Math.min(kids.length - first, ring ? 10 : 6);
        const a = this.time * (.5 - ring * .12) * dir + (i - first) / size * 6.283 + ring + P.seed * 6, rr = base + 20 + ring * 18;
        const q = { x: P.x + Math.cos(a) * rr, y: P.y + Math.sin(a) * rr * .8, z: (P.z || 0) + .2 * Math.sin(a) }, k = Math.min(1, dt * 8);
        n.gslot = q; n.x += (q.x - n.x) * k; n.y += (q.y - n.y) * k;
        n.gscale = (n.gscale ?? 1) + ((this.hover === n.sid || this.selected === n.sid ? .55 : .28) - (n.gscale ?? 1)) * Math.min(1, dt * 6);
      });
    }
  },
  groupPass(live, orb, dt) {
    const G = this.groups || {}, by = new Map();
    for (const n of live) { n.gslot = null; const g = n.s.group; if (g && G[g]) { if (!by.has(g)) by.set(g, []); by.get(g).push(n); } }
    this.moonPass(live, G, dt);
    for (const n of live) if (!(n.s.group && G[n.s.group]) && !n.moon) n.gscale = (n.gscale ?? 1) + (1 - (n.gscale ?? 1)) * Math.min(1, dt * 3);
    if (this.portals) for (const id of [...this.portals.keys()]) if (!by.has(id)) this.portals.delete(id);
    for (const [gid, m] of by) {
      m.sort((a, b) => (a.sid < b.sid ? -1 : 1));
      const P = this.portalOf(gid), k = m.length, shut = this.gShut(gid);
      // any change to the group (new, a session in / out, renamed) → its ring opens for 7 s (not on the first snapshot)
      const sig = m.map(n => n.sid).join(',') + '|' + G[gid].name;
      if (P.sig !== sig) { if (this.groupsSeen) P.peekUntil = this.time + (typeof GROUP_PEEK === 'number' ? GROUP_PEEK : 7); P.sig = sig; }
      P.members = m; P.name = G[gid].name; P.count = k; P.work = m.some(n => n.s.health === 'working');
      P.open = Math.min(1, P.open + dt / 1.3);
      P.shut += ((shut ? 1 : 0) - P.shut) * Math.min(1, dt * 2.4);
      P.rot += dt * (.12 + (P.work ? .1 : 0));
      // the main bubble: a stand-in session drawn by drawMote (organism.js) with the group's totals
      const N = P.node || (P.node = { sid: 'grp:' + gid, isGroup: true, seed: rnd(gid.length * 7.3 + gid.charCodeAt(gid.length - 1))(), x: P.x, y: P.y, vx: 0, vy: 0, born: this.time, phase: 0, flash: 0, spin: 0, swell: 0, rec: 1, gscale: 1 });
      const tot = f => m.reduce((a, n) => a + (+n.s[f] || 0), 0), health = P.work ? 'working' : m.some(n => n.s.health === 'waiting') ? 'waiting' : m.some(n => n.s.health === 'error') ? 'error' : 'idle';
      N.s = { sid: N.sid, name: P.name, color: 'portal', family: 'portal', health, totalUsd: tot('totalUsd') * 1.6 + 2, tokHr: tot('tokHr'), tps: tot('tps'), todayTok: tot('todayTok'), roots: [], model: k + ' sessions' };
      N.members = m; N.rec = Math.max(...m.map(n => n.rec ?? 0));
      N.spinRate = m.reduce((a, n) => a + (n.spinRate || 0), 0);   // the group bubble turns as fast as all its satellites together N.swell += ((this.hover === N.sid ? 1 : 0) - N.swell) * Math.min(1, dt * 8);
      const Rm = this.nodeRadius(N), Rs = Math.max(...m.map(n => this.nodeRadius(n))) * .6;
      // the satellites' ring grows with the number of sessions in it (2026-10-29): 2 → snug, 8 → wide
      const rs = Math.min(this.lite ? 300 : 560, Math.max((Rm + Rs + 26) * (1 + .3 * k) * (this.lite ? 1.15 : 1.55), k * (2 * Rs + 46) / 6.283 * 1.25));
      const a = m[0]; let c;
      if (a.dragging && P.off) c = { x: a.x - P.off.x, y: a.y - P.off.y, z: P.z };
      else { const p = orb[a.sid] ? this.orbitPos(orb[a.sid]) : { x: P.x, y: P.y, z: 0 }; c = orb[a.sid] && orb[a.sid].far ? { ...p } : this.fitInView({ ...a, labelW: 2 * rs }, p); c.z = p.z; }   // far groups live past the window's map
      P.x = c.x; P.y = c.y; P.z = c.z || 0; N.x = P.x; N.y = P.y; N.z = P.z;
      const open = 1 - P.shut;
      P.R = rs * open + (Rm + 14) * P.shut;                                       // the sling-ring: round the satellites, or hugging the bubble
      P.Rm = Rm;
      // the portal lies in a tilted plane, like a planet's ring: flattened by the system's tilt (ring drag / sun drag)
      // and rolled by the group's own orbit tilt (⌘-drag), so it turns in 3-D as you tilt things; its far half passes
      // behind the main bubble and its near half in front, and the satellites go round behind and in front too
      const k0 = this.orbitShape ? this.orbitShape().k : .4, sg = k0 < 0 ? -1 : 1;
      P.ky = sg * Math.min(.85, Math.max(.3, Math.abs(k0) + .22)); P.roll = (orb[a.sid] && orb[a.sid].tilt) || 0;
      P.Ry = P.R * Math.abs(P.ky);
      const swirl = P.shut * 5;                                                    // collapsing: they spiral into the main bubble
      m.forEach((n, i) => {
        const th = P.rot + i / k * 6.2832 + swirl, r = P.R * open + Rm * .2 * P.shut, q = this.portalPt(P, th, r);
        n.gslot = { x: q.x, y: q.y, z: P.z + .25 * Math.sin(th) };
        n.gscale = (n.gscale ?? 1) + (Math.max(0, .6 * (1 + .16 * Math.sin(th)) - P.shut * .75) - (n.gscale ?? 1)) * Math.min(1, dt * 6);   // nearer = bigger
      });
      P.off = { x: m[0].gslot.x - P.x, y: m[0].gslot.y - P.y };
    }
    if (live.length) this.groupsSeen = true;
  },
  // a point on the portal's plane: angle th (sin th > 0 = the near side), radius r → screen
  portalPt(P, th, r) {
    const ex = Math.cos(th) * r, ey = Math.sin(th) * r * P.ky, c = Math.cos(P.roll), s = Math.sin(P.roll);
    return { x: P.x + ex * c - ey * s, y: P.y + ex * s + ey * c };
  },
  portalNodes() { return this.portals ? [...this.portals.values()].map(P => P.node).filter(Boolean) : []; },

  // layer 'back': inner glow + sigil (behind the sessions); 'front': the ring of fire, sparks and the name
  drawPortals(ctx, layer, dt) {
    if (!this.portals || !this.portals.size) return;
    const t = this.time, lite = this.lite;
    for (const [gid, P] of this.portals) {
      const { x, y, R } = P, form = 1 - Math.pow(1 - P.open, 3), sig = Math.max(0, (P.open - .55) / .45), sh = P.shut;
      ctx.save();
      if (layer === 'back') {
        // the other dimension: a dim violet-blue disc with a warm rim
        ctx.save(); ctx.translate(x, y); ctx.rotate(P.roll); ctx.scale(1, Math.abs(P.ky));   // into the portal's plane
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
        g.addColorStop(0, `rgba(30,18,70,${.22 * form})`); g.addColorStop(.75, `rgba(60,24,40,${.16 * form})`); g.addColorStop(1, `rgba(255,120,40,${.12 * form})`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.2832); ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
        const a = sig * (.26 + .2 * sh) * (P.work ? 1.15 : 1);
        if (a > .01 && !this.off('mSigil')) {
          const sp = (k, s, rot) => { ctx.save(); ctx.rotate(rot); ctx.globalAlpha = a * k; ctx.drawImage(sigilSprite(s), -R, -R, 2 * R, 2 * R); ctx.restore(); };
          sp(.9, 'runes', t * .09 + P.rot); sp(.7, 'oct', -t * .14); if (!lite || sh > .5) sp(.75, 'hex', t * .22);
        }
        ctx.restore();
        if (P.open >= 1) this.portalRing(ctx, P, false);                          // the far half, behind the bubbles
      } else {
        ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
        const sc = Math.max(.7, R / 70), a0 = P.rot * 3 - Math.PI / 2, end = a0 + form * 6.2832;
        this.portalRing(ctx, P, true, P.open < 1 ? [a0, end] : null);           // the near half in front (or the arc being traced)
        if (P.open < 1) {                                             // the spark that traces the ring as it forms
          const hd = this.portalPt(P, end, R), hx = hd.x, hy = hd.y, s = 26 * sc;
          ctx.globalAlpha = 1; ctx.drawImage(glowSprite('#fff1c8'), hx - s, hy - s, 2 * s, 2 * s);
        }
        // sparks: born on the ring (at the tracing head while forming), flung along it, falling, cooling white → red
        const rate = (lite ? 70 : 230) * (.35 + .65 * form) * (1 - sh * .6) * (P.work ? 1.3 : .2), cap = lite ? 80 : 280;   // nothing running in the group: a fifth of the sparks
        P.acc += this.off('mSparks') ? 0 : rate * dt;
        while (P.acc >= 1 && P.sparks.length < cap) {
          P.acc -= 1;
          const ang = P.open < 1 ? end - Math.random() * .4 : a0 + Math.random() * 6.2832, sp = (70 + Math.random() * 150) * sc, out = (Math.random() * 60 - 10) * sc;
          const p0 = this.portalPt(P, ang, R), p1 = this.portalPt(P, ang + .01, R), tl = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
          const tx = (p1.x - p0.x) / tl, ty = (p1.y - p0.y) / tl, ol = Math.hypot(p0.x - x, p0.y - y) || 1;   // along the ring (the way it spins), and outwards
          P.sparks.push({ x: p0.x, y: p0.y, vx: tx * sp + (p0.x - x) / ol * out, vy: ty * sp + (p0.y - y) / ol * out, life: 1, d: .35 + Math.random() * .6 });
        }
        if (P.acc > 1) P.acc = 0;
        const B = [new Path2D(), new Path2D(), new Path2D()];
        P.sparks = P.sparks.filter(s => {
          s.life -= dt / s.d; if (s.life <= 0) return false;
          s.vy += 160 * sc * dt; s.vx *= Math.pow(.35, dt); s.vy *= Math.pow(.6, dt); s.x += s.vx * dt; s.y += s.vy * dt;
          const b = B[s.life > .66 ? 0 : s.life > .33 ? 1 : 2]; b.moveTo(s.x, s.y); b.lineTo(s.x - s.vx * .03, s.y - s.vy * .03);
          return true;
        });
        ctx.lineWidth = 1.3 * Math.min(1.4, sc);
        const dimS = P.work ? 1 : .45;                                // …and fainter
        [[PORTAL.hot, .95], [PORTAL.gold, .75], [PORTAL.ember, .5]].forEach(([c, al], i) => { ctx.strokeStyle = `rgba(${c.join()},${al * dimS})`; ctx.stroke(B[i]); });
        // name tag above the ring (and the count in the middle when sealed)
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = Math.min(1, form * 1.5) * (this.cineClean ? 0 : 1);
        const label = `${P.name} · ${P.count}`;
        ctx.font = '600 12px -apple-system, system-ui, sans-serif, "Apple SD Gothic Neo"'; ctx.textAlign = 'center';
        const w = ctx.measureText(label).width + 22, ly = y - Math.max(P.Ry + Math.abs(Math.sin(P.roll)) * R * .5, P.Rm) - 14;
        ctx.fillStyle = 'rgba(20,8,2,.72)'; ctx.strokeStyle = 'rgba(255,170,80,.45)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(x - w / 2, ly - 15, w, 20, 10); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ffd9a0'; ctx.fillText(label, x, ly);
      }
      ctx.restore();
    }
  },

  // the ring of fire on the portal's plane: near = the half in front of the main bubble (sin > 0), else the far half;
  // arc = [from, to] draws just that stretch (while the ring is being traced) — glow, body, white-hot core, racing dashes
  portalRing(ctx, P, near, arc) {
    const R = P.R, sc = Math.max(.7, R / 70), t = this.time, flick = .85 + .15 * Math.sin(t * 17 + P.rot * 9), Ry = Math.abs(P.ky) * R;
    // ellipse() angles: our angle th maps to th when the plane is seen from above (ky > 0), to −th from below
    const f = th => (P.ky > 0 ? th : -th);
    let from, to;
    if (arc) { from = f(arc[0]); to = f(arc[1]); } else { const lo = near ? 0 : Math.PI; from = f(lo); to = f(lo + Math.PI); }
    const ccw = P.ky < 0;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    const ring = (w, col, al, dash, off) => {
      ctx.strokeStyle = `rgba(${col.join()},${al * (near ? 1 : .7)})`; ctx.lineWidth = w * sc; ctx.setLineDash(dash || []); ctx.lineDashOffset = off || 0;
      ctx.beginPath(); ctx.ellipse(P.x, P.y, R, Ry, P.roll, from, to, ccw); ctx.stroke();
    };
    ring(16, PORTAL.ember, .09 * flick); ring(6, PORTAL.ember, .32 * flick); ring(2.6, PORTAL.gold, .75 * flick); ring(1.1, PORTAL.hot, .95);
    if (!this.lite) ring(3.2, PORTAL.gold, .55, [2 * sc, 11 * sc], -t * 260);
    ring(1.8, PORTAL.hot, .6, [1.5 * sc, 23 * sc], -t * 420);
    ctx.restore();
  },

  // the group's main bubble (or its name tag): click opens / closes the group, drag moves it (bubbles.js dragStart)
  hitPortal(p) {
    if (!this.portals) return null;
    for (const [gid, P] of this.portals) {
      const d = Math.hypot(p.x - P.x, p.y - P.y);
      if (d < (P.Rm || 20) + (this.lite ? 14 : 8) || (Math.abs(p.x - P.x) < 60 && p.y < P.y - P.Ry - 2 && p.y > P.y - Math.max(P.Ry, P.Rm) - 34)) return 'grp:' + gid;
    }
    return null;
  },
});
