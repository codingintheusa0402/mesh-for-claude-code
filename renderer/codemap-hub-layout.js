// Code map, all projects, Detail view (2026-11-27): the force layout, run in a Web Worker so the window stays smooth.
// Each project's items are laid out on their own (Barnes-Hut repulsion, link springs, a pull towards the item's area so
// areas form dense clusters, weak gravity so loose areas float as small islands), then the projects are packed as discs
// (no overlap, linked projects closer). Positions are posted every few rounds, so the picture appears at once and settles.
// Message in:  { projects: [{ n, area: Int32Array, deg: Int32Array, links: Int32Array }], plinks: [[i, j, w]], iter }
// Messages out: { type: 'pos', x: Float32Array, y: Float32Array, centers: Float32Array [cx, cy, r]*, done, round }
'use strict';

function quadForce(n, x, y, vx, vy, strength, alpha, theta2, distMax2) {
  // quadtree over the points; cells hold a linked list of points at their leaves
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { if (x[i] < x0) x0 = x[i]; if (x[i] > x1) x1 = x[i]; if (y[i] < y0) y0 = y[i]; if (y[i] > y1) y1 = y[i]; }
  const size0 = Math.max(x1 - x0, y1 - y0, 1) * 1.0001;
  const cap = n * 4 + 16;
  const cX = new Float64Array(cap), cY = new Float64Array(cap), cS = new Float64Array(cap), child = new Int32Array(cap * 4).fill(-1);
  const head = new Int32Array(cap).fill(-1), next = new Int32Array(n).fill(-1), depth = new Int32Array(cap), leaf = new Uint8Array(cap);
  const mass = new Float64Array(cap), mx = new Float64Array(cap), my = new Float64Array(cap);
  let cells = 1; cX[0] = x0; cY[0] = y0; cS[0] = size0; leaf[0] = 1;
  const quad = (c, px, py) => { const h = cS[c] / 2; return (px >= cX[c] + h ? 1 : 0) + (py >= cY[c] + h ? 2 : 0); };
  const kid = (c, q) => { let k = child[c * 4 + q]; if (k >= 0) return k; if (cells >= cap) return -1; k = cells++; const h = cS[c] / 2;
    cX[k] = cX[c] + (q & 1 ? h : 0); cY[k] = cY[c] + (q & 2 ? h : 0); cS[k] = h; leaf[k] = 1; depth[k] = depth[c] + 1; child[c * 4 + q] = k; return k; };
  for (let i = 0; i < n; i++) {
    let c = 0;
    for (;;) {
      if (!leaf[c]) { const k = kid(c, quad(c, x[i], y[i])); if (k < 0) { next[i] = head[c]; head[c] = i; break; } c = k; continue; }
      if (head[c] < 0 || depth[c] > 22) { next[i] = head[c]; head[c] = i; break; }
      // split this leaf: move its points down, then carry on with i
      let j = head[c]; head[c] = -1; leaf[c] = 0;
      while (j >= 0) { const nj = next[j]; const k = kid(c, quad(c, x[j], y[j])); if (k < 0) { next[j] = head[c]; head[c] = j; } else { next[j] = head[k]; head[k] = j; } j = nj; }
    }
  }
  for (let c = cells - 1; c >= 0; c--) {
    let m = 0, sx = 0, sy = 0;
    for (let j = head[c]; j >= 0; j = next[j]) { m++; sx += x[j]; sy += y[j]; }
    if (!leaf[c]) for (let q = 0; q < 4; q++) { const k = child[c * 4 + q]; if (k >= 0 && mass[k]) { m += mass[k]; sx += mx[k] * mass[k]; sy += my[k] * mass[k]; } }
    mass[c] = m; if (m) { mx[c] = sx / m; my[c] = sy / m; }
  }
  const stack = new Int32Array(cells + 8);
  for (let i = 0; i < n; i++) {
    let sp = 0; stack[sp++] = 0; const xi = x[i], yi = y[i]; let fx = 0, fy = 0;
    while (sp) {
      const c = stack[--sp]; if (!mass[c]) continue;
      let dx = mx[c] - xi, dy = my[c] - yi, d2 = dx * dx + dy * dy;
      if (d2 > distMax2 && cS[c] * cS[c] / d2 < theta2) continue;
      if (cS[c] * cS[c] / (d2 || 1e-9) < theta2 && !(head[c] >= 0 && leaf[c] && mass[c] === 1 && head[c] === i)) {
        if (d2 < 1) d2 = 1; const w = strength * alpha * mass[c] / d2; fx += dx * w; fy += dy * w; continue;
      }
      for (let j = head[c]; j >= 0; j = next[j]) { if (j === i) continue; let ex = x[j] - xi, ey = y[j] - yi, e2 = ex * ex + ey * ey;
        if (e2 < 1e-6) { ex = (Math.random() - .5) * 1e-3; ey = (Math.random() - .5) * 1e-3; e2 = 1e-6; } if (e2 > distMax2) continue; if (e2 < 1) e2 = Math.sqrt(e2);
        const w = strength * alpha / e2; fx += ex * w; fy += ey * w; }
      if (!leaf[c]) for (let q = 0; q < 4; q++) { const k = child[c * 4 + q]; if (k >= 0) stack[sp++] = k; }
    }
    vx[i] += fx; vy[i] += fy;
  }
}

function makeSim(P, seed) {
  const n = P.n, x = new Float64Array(n), y = new Float64Array(n), vx = new Float64Array(n), vy = new Float64Array(n);
  let s = seed >>> 0 || 1; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  // areas start on a sunflower spiral (biggest in the middle), their items around them
  const nA = P.area.reduce((m, a) => Math.max(m, a + 1), 0), cnt = new Float64Array(nA);
  for (let i = 0; i < n; i++) cnt[P.area[i]]++;
  const ax = new Float64Array(nA), ay = new Float64Array(nA); let acc = 0;
  for (let a = 0; a < nA; a++) { const r = 9 * Math.sqrt(acc + cnt[a] / 2), t = a * 2.39996; ax[a] = Math.cos(t) * r; ay[a] = Math.sin(t) * r; acc += cnt[a]; }
  for (let i = 0; i < n; i++) { const a = P.area[i], rr = 5 * Math.sqrt(cnt[a]) * Math.sqrt(rnd()), t = rnd() * 6.2832; x[i] = ax[a] + Math.cos(t) * rr; y[i] = ay[a] + Math.sin(t) * rr; }
  const L = P.links, m = L.length / 2, ldeg = new Float64Array(n);
  for (let j = 0; j < L.length; j++) ldeg[L[j]]++;
  const bias = new Float64Array(m), str = new Float64Array(m), len = new Float64Array(m);
  for (let k = 0; k < m; k++) { const a = L[2 * k], b = L[2 * k + 1]; bias[k] = ldeg[a] / (ldeg[a] + ldeg[b]); str[k] = 1 / Math.min(ldeg[a], ldeg[b]);
    len[k] = P.area[a] === P.area[b] ? 9 : 26; }
  const cx = new Float64Array(nA), cy = new Float64Array(nA);
  return { n, x, y, vx, vy, nA, cnt, cx, cy, P, m, bias, str, len, step(alpha) {
    if (!n) return;
    for (let k = 0; k < m; k++) {
      const a = L[2 * k], b = L[2 * k + 1];
      let dx = x[b] + vx[b] - x[a] - vx[a], dy = y[b] + vy[b] - y[a] - vy[a], l = Math.sqrt(dx * dx + dy * dy) || 1e-3;
      l = (l - len[k]) / l * alpha * str[k]; dx *= l; dy *= l;
      vx[b] -= dx * bias[k]; vy[b] -= dy * bias[k]; vx[a] += dx * (1 - bias[k]); vy[a] += dy * (1 - bias[k]);
    }
    quadForce(n, x, y, vx, vy, -13, alpha, .81, 150 * 150);
    cx.fill(0); cy.fill(0);
    for (let i = 0; i < n; i++) { cx[P.area[i]] += x[i]; cy[P.area[i]] += y[i]; }
    for (let a = 0; a < nA; a++) if (cnt[a]) { cx[a] /= cnt[a]; cy[a] /= cnt[a]; }
    const pull = .11 * alpha, g = .028 * alpha;
    for (let i = 0; i < n; i++) { const a = P.area[i], gi = ldeg[i] ? g : g * 3.5;   // unlinked items are held closer (no loose halo)
      if (cnt[a] > 1) { vx[i] += (cx[a] - x[i]) * pull; vy[i] += (cy[a] - y[i]) * pull; } vx[i] -= x[i] * gi; vy[i] -= y[i] * gi;
      vx[i] *= .6; vy[i] *= .6; x[i] += vx[i]; y[i] += vy[i]; }
  } };
}

// projects as discs: no overlap, linked ones closer, all held near the middle
function pack(C, R, plinks, rounds) {
  const k = R.length;
  for (let it = 0; it < rounds; it++) {
    const a = 1 - it / rounds;
    for (const [i, j, w] of plinks) { const dx = C[2 * j] - C[2 * i], dy = C[2 * j + 1] - C[2 * i + 1], d = Math.hypot(dx, dy) || 1, want = R[i] + R[j] + 120;
      if (d > want) { const f = (d - want) / d * .02 * Math.min(2, w || 1) * a; C[2 * i] += dx * f; C[2 * i + 1] += dy * f; C[2 * j] -= dx * f; C[2 * j + 1] -= dy * f; } }
    for (let i = 0; i < k; i++) { C[2 * i] *= 1 - .01 * a; C[2 * i + 1] *= 1 - .01 * a; }
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) {
      let dx = C[2 * j] - C[2 * i], dy = C[2 * j + 1] - C[2 * i + 1], d = Math.hypot(dx, dy); const min = R[i] + R[j] + 50;
      if (d < 1e-3) { dx = Math.cos(i + j); dy = Math.sin(i + j); d = 1; }
      if (d < min) { const f = (min - d) / d / 2; C[2 * i] -= dx * f; C[2 * i + 1] -= dy * f; C[2 * j] += dx * f; C[2 * j + 1] += dy * f; }
    }
  }
}

function run(msg, post) {
  const iter = msg.iter || 260, every = msg.every || 26;
  const sims = msg.projects.map((P, i) => makeSim(P, 1234 + i * 7919));
  const k = sims.length, C = new Float64Array(2 * k), R = new Float64Array(k);
  const total = sims.reduce((a, s) => a + s.n, 0), off = []; let o = 0; for (const s of sims) { off.push(o); o += s.n; }
  // first guess: discs sized by item count on a circle
  for (let i = 0; i < k; i++) { R[i] = 40 + 11 * Math.sqrt(sims[i].n); const t = i / Math.max(1, k) * 6.2832, r = 160 + 70 * k; C[2 * i] = Math.cos(t) * r; C[2 * i + 1] = Math.sin(t) * r; }
  const radius = s => {   // the radius holding 97 % of the items, around their middle
    if (!s.n) return 40; let mx = 0, my = 0; for (let i = 0; i < s.n; i++) { mx += s.x[i]; my += s.y[i]; } mx /= s.n; my /= s.n;
    for (let i = 0; i < s.n; i++) { s.x[i] -= mx; s.y[i] -= my; }
    const d = new Float64Array(s.n); for (let i = 0; i < s.n; i++) d[i] = Math.hypot(s.x[i], s.y[i]); d.sort();
    return Math.max(40, d[Math.floor(s.n * .97)] + 14);
  };
  const emit = (round, done) => {
    for (let i = 0; i < k; i++) R[i] = radius(sims[i]);
    pack(C, R, msg.plinks || [], done ? 400 : 120);
    const X = new Float32Array(total), Y = new Float32Array(total), cen = new Float32Array(3 * k);
    for (let i = 0; i < k; i++) { const s = sims[i]; for (let j = 0; j < s.n; j++) { X[off[i] + j] = s.x[j] + C[2 * i]; Y[off[i] + j] = s.y[j] + C[2 * i + 1]; } cen[3 * i] = C[2 * i]; cen[3 * i + 1] = C[2 * i + 1]; cen[3 * i + 2] = R[i]; }
    post({ type: 'pos', x: X, y: Y, centers: cen, round, done }, [X.buffer, Y.buffer, cen.buffer]);
  };
  emit(0, false);
  const decay = 1 - Math.pow(.002, 1 / iter); let alpha = 1;
  for (let r = 1; r <= iter; r++) { for (const s of sims) s.step(alpha); alpha *= 1 - decay; if (r % every === 0 && r < iter) emit(r, false); }
  emit(iter, true);
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) self.onmessage = e => run(e.data, (m, t) => self.postMessage(m, t));
else self.cmDetailLayout = run;     // no Worker (it failed to start): the page runs it itself
