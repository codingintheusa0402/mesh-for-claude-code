// Springboard-style grouping on the mesh (2026-10-29, like folders on the iPhone home screen):
//   drag a session right onto another one and hold it there 3 s → a sling-ring opens and the two become a group;
//   drag a session onto a group's portal and hold 3 s → it joins that group. A ring charges round the target while
//   you hold (gold for a group, cyan for a session); let go before it's full and nothing happens.
//   The burning sling-rings stay collapsed on the mesh whatever the Sessions list shows; any change to a group (a
//   session in or out, a new group, a rename) opens its ring for 7 s, then it folds back. A click on the portal still
//   opens / closes it by hand. (Ring radius ∝ number of sessions: portal.js groupPass.)
// Loaded after portal.js; the group itself is made by app.js (viz.onMerge → groups.create / groups.set).

const MERGE_HOLD = 3, GROUP_PEEK = 7;

Object.assign(Mesh.prototype, {
  // what the dragged bubble n is held over: a group's portal, or another (ungrouped) session it overlaps closely
  mergeTarget(n) {
    const R = this.nodeRadius(n) * (n.gscale ?? 1);
    if (this.portals) for (const [gid, P] of this.portals) {
      if (!P.node || !P.members || !P.members.length) continue;
      const reach = Math.max((P.Rm || 30) + R * .7, P.R * .55);
      if (Math.hypot(n.x - P.x, n.y - P.y) < reach) return { kind: 'group', gid, x: P.x, y: P.y, R: Math.max(P.Rm || 30, P.R * .55) + 10, key: 'g:' + gid, name: P.name };
    }
    let best = null;
    for (const m of this.nodes.values()) {
      if (m === n || m.dying || m.eaten || m.gslot || !m.s || m.s.group) continue;
      const Rm = this.nodeRadius(m) * (m.gscale ?? 1), d = Math.hypot(n.x - m.x, n.y - m.y);
      if (d < (R + Rm) * .85 && (!best || d < best.d)) best = { kind: 'node', sid: m.sid, x: m.x, y: m.y, R: Rm + 12, d, key: 'n:' + m.sid };
    }
    return best;
  },
  // per frame: the hold clock (it keeps counting while the pointer is still — a held press is the point)
  mergeStep(dt) {
    const d = this.drag, M0 = this.merge;
    if (M0 && M0.done) { if (this.time - M0.done > .9) this.merge = null; return; }
    if (!this.onMerge || !d || !d.moved || d.tilt || d.pick !== d.sid || d.sid.startsWith('grp:')) { this.merge = null; return; }
    const n = this.nodes.get(d.sid); if (!n || !n.s || n.s.group) { this.merge = null; return; }
    const T = this.mergeTarget(n); if (!T) { this.merge = null; return; }
    const M = M0 && M0.key === T.key ? M0 : (this.merge = { key: T.key, t: 0 });
    Object.assign(M, T); M.t += dt;
    if (M.t >= MERGE_HOLD) this.mergeFire(n, M);
  },
  mergeFire(n, M) {
    // the drag ends here: the bubble settles where you held it (the portal forms there when the group arrives)
    n.dragging = false; this.drag = null; this.c.style.cursor = ''; clearTimeout(this.holdTimer);
    this.dropOrbit(n);
    M.done = this.time;
    this.onMerge(n.sid, M.kind === 'group' ? { gid: M.gid } : { sid: M.sid });
  },
  // the charging ring round the target, and the flash when it fires
  drawMerge(ctx) {
    const M = this.merge; if (!M || M.x == null) return;
    const t = this.time, gold = M.kind === 'group', col = gold ? '255,186,92' : '140,225,255';
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    if (M.done) {                                                               // fired: a ring bursts outward
      const u = Math.min(1, (t - M.done) / .9), R = M.R * (1 + 1.2 * u);
      ctx.globalAlpha = Math.pow(1 - u, 1.4); ctx.strokeStyle = `rgba(${gold ? '255,225,170' : '200,245,255'},1)`; ctx.lineWidth = 3 * (1 - u) + .6;
      ctx.beginPath(); ctx.arc(M.x, M.y, R, 0, 6.2832); ctx.stroke();
      ctx.globalAlpha = Math.pow(1 - u, 2) * .7; ctx.drawImage(glowSprite(gold ? '#ffd08a' : '#bff3ff'), M.x - R * 1.3, M.y - R * 1.3, R * 2.6, R * 2.6);
      ctx.restore(); return;
    }
    const u = Math.min(1, M.t / MERGE_HOLD), e = 1 - Math.pow(1 - u, 2), wob = 1 + .03 * Math.sin(t * 18) * u;   // a little springboard wiggle as it charges
    ctx.globalAlpha = .25 + .2 * u; ctx.strokeStyle = `rgba(${col},1)`; ctx.lineWidth = 1.2; ctx.setLineDash([4, 6]); ctx.lineDashOffset = -t * 24;
    ctx.beginPath(); ctx.arc(M.x, M.y, M.R * wob, 0, 6.2832); ctx.stroke(); ctx.setLineDash([]);
    for (const [w, a] of [[7, .18], [2.6, .9]]) {
      ctx.globalAlpha = a; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(M.x, M.y, M.R * wob, -Math.PI / 2, -Math.PI / 2 + e * 6.2832); ctx.stroke();
    }
    const hx = M.x + Math.cos(-Math.PI / 2 + e * 6.2832) * M.R * wob, hy = M.y + Math.sin(-Math.PI / 2 + e * 6.2832) * M.R * wob;
    ctx.globalAlpha = .9; ctx.drawImage(glowSprite(gold ? '#ffe0a8' : '#d8f8ff'), hx - 9, hy - 9, 18, 18);
    ctx.globalCompositeOperation = 'source-over';
    if (M.t > .35) {                                                            // what will happen
      ctx.globalAlpha = Math.min(1, (M.t - .35) * 3); ctx.font = '600 11.5px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'center';
      const txt = gold ? `Hold to add to ${M.name || 'this group'}` : 'Hold to group these sessions', w = ctx.measureText(txt).width + 20, y = M.y - M.R * wob - 26;
      ctx.fillStyle = 'rgba(0,0,0,.72)'; ctx.beginPath(); ctx.roundRect(M.x - w / 2, y - 13, w, 22, 11); ctx.fill();
      ctx.fillStyle = `rgba(${col},1)`; ctx.fillText(txt, M.x, y + 2);
    }
    ctx.restore();
  },
});

// hook into the portals' front layer (world space, every frame)
{
  const portals0 = Mesh.prototype.drawPortals;
  Mesh.prototype.drawPortals = function (ctx, layer, dt) {
    const r = portals0.call(this, ctx, layer, dt);
    if (layer === 'front') { this.mergeStep(dt || 0); this.drawMerge(ctx); }
    return r;
  };
}
