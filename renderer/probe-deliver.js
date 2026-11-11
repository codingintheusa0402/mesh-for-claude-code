// The probe carries an implant (2026-10-29): when a skill / connector from the Endurance's hangar (hangar.js) is put into a
// session, the probe flies to the Endurance's dock, the item materialises there (its gold line-art icon in a glowing
// capsule) and is drawn up under the droid, it swoops across to the session's bubble with the capsule hanging below,
// then lowers it in — the capsule shrinks into the bubble, a ring pulses out — and only then the command is typed into
// the session (the callback). A tidy-up in progress pauses for it and carries on after. Grabbing the probe, or losing it,
// delivers at once (the command is never lost). Loaded after probe-tidy.js.

const deliverIcons = {};
function deliverIcon(url) {
  const key = url || 'none'; if (deliverIcons[key]) return deliverIcons[key];
  const im = new Image(); if (url) im.src = url; return (deliverIcons[key] = im);
}

Object.assign(Mesh.prototype, {
  // start a delivery; false = the probe can't (dead / held / no Endurance) and the caller types right away
  probeDeliver(sid, item, onArrive) {
    const P = this.probeState(); if (!P || P.mode === 'dead' || P.held || P.fall || this.compact || this.off('mEndurance') || !this.endDock) return false;
    if (P.deliver) { const D = P.deliver; P.deliver = null; D.cb && D.cb(); }      // (one at a time: the earlier one lands now)
    if (P.tidy) {                                                               // a tidy-up pauses (the bubble in hand goes back)
      const T = P.tidy; if (T.it && (T.phase === 'grab' || T.phase === 'tow' || T.phase === 'set')) { this.tidyRelease(T.it, T.q.jobs[T.i], false); T.redo = T.i; }
      T.phase = 'next'; T.it = null; P.tidyPaused = T; P.tidy = null;
    }
    P.deliver = { sid, item, cb: onArrive, phase: 'dock', t0: this.time, img: deliverIcon(item.px) };
    P.mode = 'deliver'; P.queue = null; P.target = null; P.scan = null; P.grav = null; P.napUntil = 0;
    P.say = { text: probeLine('deliverStart', ['Special delivery. Sign here.', 'Hauling contraband from the Endurance. Don\'t ask.', 'One upgrade, coming through.', 'Got a package for you, boss.']), health: 'working', name: 'Probe', t0: this.time, hold: this.time + 2.5 };
    return true;
  },
  probeDeliverEnd(P, ok) {
    const D = P.deliver; P.deliver = null;
    if (D && D.cb) D.cb();
    if (P.tidyPaused) { P.tidy = P.tidyPaused; P.tidyPaused = null; P.mode = 'tidy'; }
    else if (P.mode === 'deliver') { P.mode = 'cruise'; this.probeNext(P); }
    if (ok && D) P.say = { text: probeLine('deliverDone', [`${D.item.label}: installed. Use it well.`, 'Implant in. Try not to fuck it up.', 'Delivered. No receipt, no bullshit.'], { item: D.item.label }), health: 'working', name: 'Probe', t0: this.time, hold: this.time + 2.4 };
  },
  probeDeliverStep(P, dt, base) {
    const D = P.deliver, t = this.time, age = t - D.t0, S = base, perch = S * 1.2 + 6;
    const n = this.nodes.get(D.sid), node = n && !n.dying && !n.eaten ? (n.gslot && this.portals && this.portals.get(n.s.group) && this.portals.get(n.s.group).shut > .5 ? this.portals.get(n.s.group).node : n) : null;
    if (!node) { this.probeDeliverEnd(P, false); return false; }
    const dock = this.endDock(), R = this.nodeRadius(node) * (node.gscale ?? 1);
    P.idleSince = t; P.nextLand = Math.max(P.nextLand || 0, t + 30);
    const steer = (tx, ty, k, max) => {
      const ax = (tx - P.x) * k - P.vx * 2 * Math.sqrt(k) * .9, ay = (ty - P.y) * k - P.vy * 2 * Math.sqrt(k) * .9;
      P.vx += ax * dt; P.vy += ay * dt; const sp = Math.hypot(P.vx, P.vy); if (sp > max) { P.vx *= max / sp; P.vy *= max / sp; }
      P.x += P.vx * dt; P.y += P.vy * dt;
    };
    const ease = u => u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    if (D.phase === 'dock') {                                                   // to the Endurance's dock
      steer(dock.x, dock.y - perch, 10, 640);
      if ((Math.hypot(P.x - dock.x, P.y - dock.y + perch) < 12 && Math.hypot(P.vx, P.vy) < 80) || age > 3.2) { D.phase = 'load'; D.t0 = t; }
      D.cx = dock.x; D.cy = dock.y; D.cs = 0;
    } else if (D.phase === 'load') {                                            // the item materialises at the dock and rises to the droid
      const u = Math.min(1, age / .9); steer(dock.x, dock.y - perch, 14, 300);
      D.cs = ease(Math.min(1, u * 1.6)); D.cx = dock.x; D.cy = dock.y - (perch * .55) * ease(u);
      if (u >= 1) { D.phase = 'carry'; D.t0 = t; D.from = { x: P.x, y: P.y }; const d = Math.hypot(node.x - P.x, node.y - P.y); D.dur = Math.max(1, Math.min(2.6, d / 360)); D.bvx = D.bvy = 0; }
    } else if (D.phase === 'carry') {                                           // a swooping arc to the bubble, the capsule swinging below
      const u = Math.min(1, age / D.dur), e = ease(u), a = 1 - e, ex = node.x, ey = node.y - R - perch;
      const mx = (D.from.x + ex) / 2, my = Math.min(D.from.y, ey) - Math.min(160, Math.hypot(ex - D.from.x, ey - D.from.y) * .3);
      const nx = a * a * D.from.x + 2 * a * e * mx + e * e * ex, ny = a * a * D.from.y + 2 * a * e * my + e * e * ey;
      P.vx = (nx - P.x) / Math.max(dt, 1e-3); P.vy = (ny - P.y) / Math.max(dt, 1e-3); P.x = nx; P.y = ny;
      const hx = P.x, hy = P.y + perch * .55, k = 70, c = 2 * Math.sqrt(k) * .5;  // a damped pendulum
      D.bvx += ((hx - D.cx) * k - D.bvx * c) * dt; D.bvy += ((hy - D.cy) * k - D.bvy * c) * dt; D.cx += D.bvx * dt; D.cy += D.bvy * dt; D.cs = 1;
      if (u >= 1) { D.phase = 'implant'; D.t0 = t; D.sx = D.cx; D.sy = D.cy; }
    } else if (D.phase === 'implant') {                                         // lowered into the bubble, shrinking in; a ring pulses out
      const u = Math.min(1, age / .8), e = ease(u); steer(node.x, node.y - R - perch, 14, 300);
      D.cx = D.sx + (node.x - D.sx) * e; D.cy = D.sy + (node.y - D.sy) * e; D.cs = 1 - e * .85;
      if (u >= 1) { D.pulse = { x: node.x, y: node.y, R, t0: t, color: D.item.color }; this.deliverPulse = D.pulse; node.flash = 1; this.probeDeliverEnd(P, true); return true; }
    }
    // pose: face the motion, bank into turns, hover bob (like the tidy-up)
    const sp = Math.hypot(P.vx, P.vy), want = sp > 25 ? Math.atan2(P.vx, P.vy) : 0;
    { let d = want - P.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); P.yaw += d * Math.min(1, dt * (sp > 25 ? 5 : 2)); }
    const hd = Math.atan2(P.vy, P.vx); let w = 0; if (sp > 25 && P.hd != null) { w = hd - P.hd; w = Math.atan2(Math.sin(w), Math.cos(w)) / Math.max(dt, 1e-3); }
    P.hd = sp > 25 ? hd : P.hd; P.bank = (P.bank || 0) + (Math.max(-.6, Math.min(.6, w * .22)) - (P.bank || 0)) * Math.min(1, dt * 5);
    P.z += (0 - P.z) * Math.min(1, dt * 3); P.gs = 1;
    if (P.say && !P.say.out && !(P.say.hold > t)) P.say.out = t;
    if (P.say && P.say.out && t - P.say.out > .45) P.say = null;
    P.S = S * (1 + .35 * P.z); P.dx = P.x; P.dy = P.y + Math.sin(t * 2.4) * 2; P.sp = sp;
    return true;
  },
  // the capsule (and its tether to the droid), and the implant pulse — drawn just before the droid
  drawDeliver(ctx) {
    const P = this.probe, D = P && P.deliver, t = this.time;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    if (D && D.cs > .01 && D.cx != null) {
      const s = 30 * D.cs, col = D.item.color;
      if (D.phase === 'carry' || D.phase === 'implant' || D.phase === 'load') {
        ctx.strokeStyle = col; ctx.globalAlpha = .55; ctx.lineWidth = 1.4; ctx.setLineDash([3, 4]); ctx.lineDashOffset = -t * 30;
        ctx.beginPath(); ctx.moveTo(P.dx, P.dy + P.S * .4); ctx.lineTo(D.cx, D.cy - s * .6); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.globalAlpha = .55 * D.cs; ctx.drawImage(glowSprite(col), D.cx - s * 1.5, D.cy - s * 1.5, s * 3, s * 3);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = Math.min(1, D.cs * 1.4);
      ctx.fillStyle = 'rgba(8,10,16,.85)'; ctx.strokeStyle = col; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(D.cx - s * .62, D.cy - s * .62, s * 1.24, s * 1.24, s * .18); ctx.fill(); ctx.stroke();
      if (D.img.complete && D.img.naturalWidth) { const sm = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false; ctx.drawImage(D.img, D.cx - s * .5, D.cy - s * .5, s, s); ctx.imageSmoothingEnabled = sm; }
      if (D.cs > .6) { ctx.font = '600 10px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = col; ctx.fillText(D.item.label.length > 22 ? D.item.label.slice(0, 21) + '…' : D.item.label, D.cx, D.cy + s * .62 + 13); }
      ctx.globalCompositeOperation = 'lighter';
    }
    const Q = this.deliverPulse;
    if (Q) { const u = (t - Q.t0) / 1; if (u >= 1) this.deliverPulse = null; else {
      for (const [k, w] of [[1, 2.5], [1.35, 1.2]]) { ctx.globalAlpha = Math.pow(1 - u, 1.5) * .9; ctx.strokeStyle = Q.color; ctx.lineWidth = w * (1 - u) + .5; ctx.beginPath(); ctx.arc(Q.x, Q.y, Q.R * (1 + u * k), 0, 6.2832); ctx.stroke(); }
      ctx.globalAlpha = Math.pow(1 - u, 2) * .6; ctx.drawImage(glowSprite(Q.color), Q.x - Q.R * 1.6, Q.y - Q.R * 1.6, Q.R * 3.2, Q.R * 3.2); } }
    ctx.restore();
  },
});
{
  const life0 = Mesh.prototype.probeLife;
  Mesh.prototype.probeLife = function (P, dt, base) {
    if (P.deliver && (P.held || P.fall || P.mode === 'dead')) this.probeDeliverEnd(P, false);   // grabbed / lost: delivered at once
    else if (P.deliver) return this.probeDeliverStep(P, dt, base);
    return life0.call(this, P, dt, base);
  };
  const body0 = Mesh.prototype.probeBody;
  Mesh.prototype.probeBody = function (ctx, dt) { this.drawDeliver(ctx); return body0.call(this, ctx, dt); };
  const doing0 = Mesh.prototype.probeDoing;
  Mesh.prototype.probeDoing = function () { const P = this.probeState(); return P.deliver ? `Delivering ${P.deliver.item.label}` : doing0.call(this); };
}
