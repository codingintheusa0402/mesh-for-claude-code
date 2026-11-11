// The mother bubble at the centre: a burning star whose layers age with usage (see starColor) generated once as a mottled texture, then drawn in thin horizontal strips
// with drifting offsets every frame so it ripples like heat haze. Its gravity swallows every
// bubble the sessions produce (bubbles.js); the plan-usage card sits just below it.
function vnoise(seed) {
  const P = new Uint8Array(512), r = rnd(seed);
  for (let i = 0; i < 256; i++) P[i] = i;
  for (let i = 255; i > 0; i--) { const j = r() * (i + 1) | 0; [P[i], P[j]] = [P[j], P[i]]; }
  for (let i = 0; i < 256; i++) P[i + 256] = P[i];
  const G = Float32Array.from({ length: 256 }, () => r());
  const sm = t => t * t * (3 - 2 * t);
  const n2 = (x, y) => {
    const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255, xf = x - Math.floor(x), yf = y - Math.floor(y);
    const a = G[P[xi + P[yi]]], b = G[P[xi + 1 + P[yi]]], c = G[P[xi + P[yi + 1]]], d = G[P[xi + 1 + P[yi + 1]]];
    const u = sm(xf), v = sm(yf); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x, y, oct = 4) => { let s = 0, amp = .5, f = 1; for (let i = 0; i < oct; i++) { s += amp * n2(x * f, y * f); amp *= .5; f *= 2.03; } return s / (1 - Math.pow(.5, oct)); };
}

// Star ageing. Each layer is a black-body colour that cools from a young hot star (blue-white)
// to an old one (orange-red) as its usage window is consumed:
// Each layer follows one row of the "Usage left" card, and that row's bar takes the same colour (2026-10-19):
//   white-hot centre ← All models (weekly) on USED_RAMP: bright white … vivid red as it runs out
//   body             ← Session (5-hour): the black-body ageing it always had, ending in vivid red
//   rim              ← the model's own weekly limit (e.g. Fable), same style, ending in vivid red
//   flares + waves   ← time to the session reset (resetColor, below)
function kelvinRGB(T) {
  const t = T / 100, c = v => Math.max(0, Math.min(255, v));
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [c(r), c(g), c(b)];
}
const STAR_AGE = { outer: [18000, 1700], mid: [14000, 2700], core: [30000, 3800] };
function starColor(zone, age, sat = 1.6) {
  const [T0, T1] = STAR_AGE[zone], T = Math.exp(Math.log(T0) + (Math.log(T1) - Math.log(T0)) * Math.min(1, Math.max(0, age)));
  const [r, g, b] = kelvinRGB(T), m = (r + g + b) / 3;                      // black-body hues are pale: boost saturation
  return [r, g, b].map(v => Math.max(0, Math.min(255, m + (v - m) * sat)));
}
// "All models" used 0 → 100 %: bright white → sky blue → bright yellow → bright orange → dark orange → light red → vivid red
const USED_RAMP = [[255, 255, 255], [140, 205, 255], [255, 228, 60], [255, 155, 35], [205, 85, 10], [255, 95, 95], [230, 15, 30]];
const VIVID = USED_RAMP[USED_RAMP.length - 1];
function usedColor(u) {
  const x = Math.min(1, Math.max(0, u || 0)) * (USED_RAMP.length - 1), i = Math.min(USED_RAMP.length - 2, Math.floor(x)), f = x - i;
  return USED_RAMP[i].map((v, k) => v + (USED_RAMP[i + 1][k] - v) * f);
}
// colour of a layer for a used fraction u (0 = full, 1 = spent)
function layerColor(zone, u) {
  if (zone === 'core') return usedColor(u);
  const c = starColor(zone, u, zone === 'outer' ? 1.8 : 1.6), k = Math.min(1, Math.max(0, (u - .6) / .4)), w = k * k * (3 - 2 * k);
  return c.map((v, i) => v + (VIVID[i] - v) * w);                          // the last 40 % blends into vivid red
}
// 2026-10-26: the flares and waves (spicules, prominence arches, flame licks, the limb glow and haze) count down the
// session (5-hour) limit: light blue → lavender → magenta → vivid red over the last 4 hours before it resets
const RESET_RAMP = [[150, 215, 255], [165, 165, 255], [225, 110, 225], [255, 70, 115], [235, 20, 35]], RESET_SPAN = 4 * 3600e3;
function resetColor(u) {
  const x = Math.min(1, Math.max(0, u)) * (RESET_RAMP.length - 1), i = Math.min(RESET_RAMP.length - 2, Math.floor(x)), f = x - i;
  return RESET_RAMP[i].map((v, k) => v + (RESET_RAMP[i + 1][k] - v) * f);
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// The star is a sphere turning slowly on a tilted axis (≈ one turn / 2 min, like footage of the Sun): its surface
// (granulation, bright faculae, dark spot belts) lives on an equirectangular map that is re-projected onto the disk
// a few times a second (SUN_STEP); colours still come from the usage layers below.
const SUN_TURN = 120, SUN_STEP = .15, SUN_TILT = .26, SUN_ROLL = .4;     // SUN_ROLL: axial tilt sideways (~23°, like Earth's)                      // s per turn, s between re-projections, axis tilt (rad)
const SUN_W = 1024, SUN_H = 512;
const FLAME_K = 1.45;                                                       // the corona texture reaches this × R
let SUN_MAP = null, SUN_LUT = null;
// cellular (Worley) noise on the sphere: distance to the nearest two feature points of a 3-D grid. Cell borders
// (F2 − F1 ≈ 0) draw the cracked network of magma veins; the cell interiors are the dark floor between them.
const _h3 = (x, y, z, k) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647 + k * 1103515245) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function worley(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z); let f1 = 9, f2 = 9;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
    const cx = ix + a, cy = iy + b, cz = iz + c;
    const dx = cx + _h3(cx, cy, cz, 1) - x, dy = cy + _h3(cx, cy, cz, 2) - y, dz = cz + _h3(cx, cy, cz, 3) - z, d = dx * dx + dy * dy + dz * dz;
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  return Math.sqrt(f2) - Math.sqrt(f1);                     // 0 on a cell border, larger toward a cell's middle
}
function sunMap() {
  if (SUN_MAP) return SUN_MAP;
  const a = vnoise(.37), b = vnoise(.81), c = vnoise(.23), N = SUN_W * SUN_H;
  const m = new Float32Array(N), m2 = new Float32Array(N), sp = new Float32Array(N), lm = new Float32Array(N);
  for (let v = 0; v < SUN_H; v++) for (let u = 0; u < SUN_W; u++) {
    const lon = u / SUN_W * 6.2832, lat = (v / (SUN_H - 1) - .5) * Math.PI, cl = Math.cos(lat);
    const X = cl * Math.cos(lon), Y = cl * Math.sin(lon), Z = Math.sin(lat), i = v * SUN_W + u;   // a point on the sphere → seamless
    // 2026-10-21, after the user's reference render: a cracked network of bright magma veins over darker cells,
    // hot clusters where veins knot together, fine sparkle everywhere
    const warp = (b(X * 4 + 3, Y * 4 + 1, 2) - .5) * .35;                                    // bends the cell grid so no straight edges show
    const big = worley((X + warp) * 5.5 + 7, (Y - warp) * 5.5 + 3, Z * 5.5 + 11);              // large cells
    const small = worley(X * 13 + 2, (Y + warp) * 13 - 6, (Z - warp) * 13 + 4);                // small cells inside them
    const fine = .5 * b(X * 46 + 2, Y * 46 - 6, 2) + .5 * b(Z * 46 + 4, X * 46 + 9, 2);         // sparkle grain
    const blotch = .5 * a(X * 3.2 + 7, Y * 3.2 + 3, 3) + .5 * a(Y * 3.2 - 5, Z * 3.2 + 11, 3);  // slow brightness tides
    const cl2 = .5 * c(X * 7 + 1, Y * 7 + 2, 3) + .5 * c(Y * 7 - 3, Z * 7 + 5, 3);              // hot clusters
    const vb = 1 - sstep(0, .14, big), vs = 1 - sstep(0, .1, small);
    m2[i] = Math.min(1.3, (vb * vb * (.75 + .5 * fine) + .55 * vs * vs * (.5 + .7 * fine)) * (.8 + .7 * Math.max(0, blotch - .35)));   // vein brightness
    m[i] = sstep(.6, .72, cl2 + (fine - .5) * .16) * (.5 + .5 * fine) * (.4 + .6 * Math.max(vb, vs));                              // cluster glow, on the veins
    sp[i] = .16 + .1 * fine + .08 * Math.max(0, blotch - .5) * 2;                                                                  // the dark cell floor
    lm[i] = sp[i] + .85 * m2[i] + .55 * m[i];                                                                                    // dark cells, bright veins, hot clusters
  }
  return SUN_MAP = { m, m2, sp, lm };
}
// screen pixel → surface (lon, lat) for a spin axis leaning SUN_ROLL sideways (axial tilt, like a real star/planet)
// and `pitch` toward you (SUN_TILT + the orbit system's tilt, so tilting the ring tilts the star with it).
// Rebuilt only when the pitch moves by ≥ ~0.3° (while you tilt the ring); mu (depth) depends on the screen only.
function sunLut(S, pitch = SUN_TILT) {
  const q = Math.round(pitch / .005) * .005;
  if (SUN_LUT && SUN_LUT.S === S && SUN_LUT.q === q) return SUN_LUT;
  const C = S / 2, N = S * S, lon = new Float32Array(N), row = new Int32Array(N), mu = new Float32Array(N);
  const cb = Math.cos(q), sb = Math.sin(q), cr = Math.cos(SUN_ROLL), sr = Math.sin(SUN_ROLL);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx0 = (x - C) / C, dy0 = (y - C) / C, r2 = dx0 * dx0 + dy0 * dy0, i = y * S + x; if (r2 > 1) continue;
    const dx = dx0 * cr + dy0 * sr, dy = -dx0 * sr + dy0 * cr;                               // undo the sideways lean
    const z = Math.sqrt(1 - r2), y2 = dy * cb - z * sb, z2 = dy * sb + z * cb;                 // tilt the spin axis toward us
    lon[i] = (Math.atan2(dx, z2) / 6.2832 + 1) * SUN_W; row[i] = Math.round((Math.asin(Math.max(-1, Math.min(1, -y2))) / Math.PI + .5) * (SUN_H - 1)) * SUN_W; mu[i] = z;
  }
  return SUN_LUT = { S, q, lon, row, mu };
}

let MOTHER_NOISE = null;
// built when the usage colours change: the corona texture + per-pixel tables for projectMother (prev: unused, kept for callers)
function makeMotherTextures(ages, S = 360, rot = 0, prev = null, pitch = SUN_TILT) {
  const C = S / 2;
  if (!MOTHER_NOISE) {                                                       // screen-fixed noise, for the flame licks only
    const n2 = vnoise(.81), N = S * S;
    MOTHER_NOISE = { f: new Float32Array(N), n2 };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) MOTHER_NOISE.f[y * S + x] = n2(x / 14 + 9, y / 14 - 3);
  }
  const { f: NF } = MOTHER_NOISE, L = sunLut(S, pitch);
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
  const same = prev && prev.colKey === JSON.stringify(ages);
  const body = mk(), bx = body.getContext('2d'), bi = bx.createImageData(S, S);
  const cMid = layerColor('mid', ages.mid), cCore = layerColor('core', ages.core), cOut = layerColor('outer', ages.outer);
  const cMid2 = layerColor('mid', Math.min(1, ages.mid + .18)).map(v => v * .92);   // deeper tone toward the rim for depth
  const white = .45 * Math.max(0, 1 - ages.core * 1.3);                   // the inner glow (All models) loses its white as it reddens
  // corona: the flame texture spans FLAME_K × R (fibrous tufts and loops outside the disk), drawn larger than the body
  let flame = same ? prev.flame : mk(), fx = flame.getContext('2d'), fi = same ? null : fx.createImageData(S, S);
  const pix = [], lonA = [], mulA = [], floorA = [], alA = [], zc = [[], [], []];
  const FK = FLAME_K, cf = [0, 1, 2].map(q => cOut[q] * .55 + cMid[q] * .45), cfh = cf.map(v => v + (255 - v) * .45);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x - C) / C, dy = (y - C) / C, r = Math.hypot(dx, dy), o = (y * S + x) * 4, i = y * S + x;
    if (fi) {                                                                                   // ---- corona (r in units of R, up to FK)
      const rr = r * FK, ang = Math.atan2(dy, dx);
      if (rr > .8 && rr < FK) {
        const nf = MOTHER_NOISE.n2;
        const tuft = .5 + .5 * Math.sin(ang * 7 + nf(Math.cos(ang) * 3 + 5, Math.sin(ang) * 3 + 2, 2) * 9);                       // uneven tufts around the limb
        const fib = Math.pow(1 - Math.abs(2 * nf(ang * 11 + rr * .6, rr * 7 + 3, 2) - 1), 2.5);                                   // radial fibres
        const loops = Math.pow(1 - Math.abs(2 * nf(ang * 5 + 9, rr * 3.5 - ang * 1.5, 3) - 1), 7) * sstep(.95, 1.05, rr) * (1 - sstep(1.12, 1.3, rr));   // thin arcing loops
        const fall = Math.max(0, 1 - (rr - .92) / (FK - .92));
        let f = Math.pow(fall, 2.6) * (.2 + .8 * tuft) * (.35 + .65 * fib) * .8 + .9 * loops * (.4 + .6 * tuft);
        f *= sstep(.8, .96, rr);
        const wh = Math.min(.35, Math.max(0, f - .5) * .8);
        fi.data[o] = Math.min(255, cf[0] + (cfh[0] - cf[0]) * wh); fi.data[o + 1] = Math.min(255, cf[1] + (cfh[1] - cf[1]) * wh); fi.data[o + 2] = Math.min(255, cf[2] + (cfh[2] - cf[2]) * wh);
        fi.data[o + 3] = 255 * Math.min(1, f);
      }
    }
    if (r > 1) continue;                                                                        // ---- the disk: per-pixel tables only
    const t = r, wc = 1 - sstep(.08, .26, t), wo = sstep(.62, .8, t), wm = Math.max(0, 1 - wc - wo), mid = sstep(.25, .62, t);
    const limb = sstep(.78, .97, r), edge = r + (NF[i] - .5) * .05;
    for (let q = 0; q < 3; q++) zc[q].push(wc * (cCore[q] * (1 - white) + 255 * white) + wm * (cMid[q] * (1 - mid) + cMid2[q] * mid) + wo * cOut[q]);
    pix.push(o); lonA.push(i);
    mulA.push((1 + .3 * limb * limb) * (.86 + .14 * Math.pow(L.mu[i], .35)));                  // the edge glows; a hint of limb shading
    floorA.push(t < .1 ? 1.05 - .25 * ages.core : 0);
    alA.push(255 * (edge < .935 ? 1 : Math.max(0, 1 - (edge - .935) / .065)));                // fuzzy, fibrous edge — no hard limb
  }
  if (fi) fx.putImageData(fi, 0, 0);
  const F = a => Float32Array.from(a), T = { pix: Int32Array.from(pix), li: Int32Array.from(lonA), mul: F(mulA), floor: F(floorA), al: F(alA), cr: F(zc[0]), cg: F(zc[1]), cb: F(zc[2]) };
  const tex = { body, bctx: bx, img: bi, T, flame, S, outer: cOut, colKey: JSON.stringify(ages) };
  projectMother(tex, rot, pitch);
  return tex;
}
// re-project the turning surface onto the disk: a table walk with a bilinear step in longitude, cheap enough to run
// every frame (120–144 Hz) so the rotation is perfectly smooth (2026-10-21; it used to step every 0.15 s)
function projectMother(tex, rot, pitch = SUN_TILT) {
  const L = sunLut(tex.S, pitch), { T, img } = tex, d = img.data, lm = sunMap().lm, W = SUN_W, shift = (((rot / 6.2832) % 1) + 1) % 1 * W, n = T.pix.length;
  for (let j = 0; j < n; j++) {
    const li = T.li[j]; let s = L.lon[li] + shift; if (s >= W) s -= W; if (s >= W) s -= W;
    const u0 = s | 0, f = s - u0, u1 = u0 + 1 === W ? 0 : u0 + 1, row = L.row[li];
    let lum = (lm[row + u0] * (1 - f) + lm[row + u1] * f) * T.mul[j]; if (lum < T.floor[j]) lum = T.floor[j];
    const wh = lum > 1.1 ? Math.min(.3, (lum - 1.1) * .4) : 0, o = T.pix[j];               // the hottest veins run white
    d[o] = (T.cr[j] + (255 - T.cr[j]) * wh) * lum; d[o + 1] = (T.cg[j] + (255 - T.cg[j]) * wh) * lum; d[o + 2] = (T.cb[j] + (255 - T.cb[j]) * wh) * lum; d[o + 3] = T.al[j];
  }
  tex.bctx.putImageData(img, 0, 0);
}

// a usage row's colour = the colour of the star layer it drives (other rows: the All-models ramp)
const LIMIT_ZONE = l => l.kind === 'session' ? 'mid' : l.kind === 'weekly_all' ? 'core' : 'outer';
function limitColor(left, l) {
  const c = layerColor(l ? LIMIT_ZONE(l) : 'core', 1 - Math.max(0, Math.min(100, left)) / 100);
  return `rgb(${c.map(v => Math.round(v)).join()})`;
}
function fmtReset(t) {
  const m = Math.max(0, (t - Date.now()) / 60000);
  if (!t) return '—';
  if (m < 60) return Math.ceil(m) + 'm';
  if (m < 1440) return Math.floor(m / 60) + 'h ' + Math.floor(m % 60) + 'm';
  return Math.floor(m / 1440) + 'd ' + Math.floor(m % 1440 / 60) + 'h';
}

Object.assign(Mesh.prototype, {
  // the star's size before your shift + scroll resize — the bubbles are sized against this, so resizing the star
  // doesn't resize them
  motherBase() { return Math.max(this.compact ? 22 : 56, Math.min(104, Math.min(this.w, this.h) * (this.compact ? .16 : .13))); },
  motherRadius() {                                                // × your shift + scroll size (handles.js, up to 300%), never past 42% of the window
    const r = this.motherBase();
    return this.compact || !this.sizeOf ? r : Math.min(r * this.sizeOf('hub'), Math.min(this.w, this.h) * .42);
  },
  galaxyRadius() { return this.motherRadius(); },          // older call sites (orbit sizing, pixel mode)
  // flare colour from how near the session limit's reset is (null: no limit known → the usage colours as before)
  flareColor() {
    const l = ((this.hub.usage && this.hub.usage.limits) || []).find(x => x.kind === 'session');
    if (!l || !l.resetsAt) return null;
    const left = l.resetsAt - Date.now(); return resetColor(left <= 0 ? 0 : 1 - left / RESET_SPAN);
  },
  // the flame-lick texture recoloured (cached; redone when the colour moves a step or the texture is rebuilt)
  tintFlame(src, c) {
    const T = this.ftint || (this.ftint = {}), key = c.map(v => v >> 3).join();
    if (T.src !== src || T.key !== key) {
      const cv = T.cv || (T.cv = document.createElement('canvas')); cv.width = src.width; cv.height = src.height;
      const x = cv.getContext('2d'); x.drawImage(src, 0, 0);
      x.globalCompositeOperation = 'source-atop'; x.globalAlpha = .85; x.fillStyle = `rgb(${c.map(Math.round)})`; x.fillRect(0, 0, cv.width, cv.height);
      T.src = src; T.key = key;
    }
    return T.cv;
  },
  starAges() {
    const L = (this.hub.usage && this.hub.usage.limits) || [], pct = k => { const l = L.find(x => x.kind === k); return l ? l.used / 100 : 0; };
    const model = L.find(l => l.kind !== 'session' && l.kind !== 'weekly_all');   // e.g. Fable's own weekly limit
    return { mid: pct('session'), core: pct('weekly_all'), outer: model ? model.used / 100 : pct('session') };
  },

  // heat haze: the body texture in thin strips, each nudged sideways by drifting sine waves
  drawMother(ctx, cx, cy, R, smooth = true) {
    const ages = this.starAges(), key = [ages.outer, ages.mid, ages.core].map(v => Math.round(v * 50)).join();
    // the turning surface is re-projected every frame (smooth renderer; every SUN_STEP s in the pixel one); colours change at most every 2 s
    const recolor = !this.mtex || (this.mtex.key !== key && this.time - (this.mtexAt || 0) > 2), rot = this.time * 6.2832 / SUN_TURN + (this.sysRot || 0);   // + the orbit system's turn: spinning the ring spins the star with it
    const pitch = SUN_TILT + (this.sysTilt || 0);                                          // tilting the orbit ring tilts the star's axis too
    if (recolor) { this.mtex = makeMotherTextures(ages, 440, rot, null, pitch); this.mtex.key = key; this.mtexAt = this.mtex.rotAt = this.time; }
    else {
      // the per-pixel re-projection (the costliest thing in a frame): on its own the star turns once in 2 min — far under a
      // pixel per frame — so ~20×/s looks the same; while you spin / tilt the system it follows every frame
      // (iPhone 15×/s; the pixel renderer every SUN_STEP s)
      const M = this.mtex, moved = Math.abs(rot - (M.pRot ?? rot)) + Math.abs(pitch - (M.pPitch ?? pitch)), since = this.time - (M.rotAt || 0);
      if (smooth && !this.lite ? (moved > .006 || since > 1 / 20) : since > (this.lite ? 1 / 15 : SUN_STEP)) { projectMother(M, rot, pitch); M.rotAt = this.time; M.pRot = rot; M.pPitch = pitch; }
    }
    const { body, S } = this.mtex, fc = this.flareColor(), flame = fc ? this.tintFlame(this.mtex.flame, fc) : this.mtex.flame, t = this.time, heat = Math.min(1, (this.hub.mass || 0) / 10);
    R *= 1 + .014 * Math.sin(t * 1.7) + heat * .05;
    ctx.save(); ctx.imageSmoothingEnabled = smooth;
    const N = smooth && !this.lite ? 34 : 20, sh = S / N, dh = 2 * R / N, amp = R * (.006 + heat * .012);
    for (let i = 0; i < N; i++) {
      const off = Math.sin(i * .43 + t * 3.6) * amp + Math.sin(i * .19 - t * 2.1) * amp * .6;
      const x = cx - R + (smooth ? off : Math.round(off)), y = cy - R + i * dh;
      ctx.drawImage(body, 0, i * sh, S, sh + .6, x, y, 2 * R, dh + .6);
    }
    // flickering flame licks on the rim (two counter-rotating copies)
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(cx, cy);
    const FR = R * FLAME_K;
    ctx.rotate(t * .05); ctx.globalAlpha = .2 + .04 * Math.sin(t * 1.3); ctx.drawImage(flame, -FR, -FR, 2 * FR, 2 * FR);
    ctx.rotate(-t * .12); ctx.globalAlpha = .16 + .05 * Math.sin(t * 1.9 + 1); ctx.drawImage(flame, -FR * 1.03, -FR * 1.03, 2.06 * FR, 2.06 * FR);
    ctx.restore();
    if (!smooth) return;
    ctx.globalCompositeOperation = 'lighter';
    // white-hot core, pulsing (brighter while bubbles are being swallowed)
    const cr = R * (.16 + .1 * ages.core + .04 * Math.sin(t * 6.2) + heat * .08);   // a little larger as it reddens, so it reads
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
    const u = ages.core, hot = usedColor(u).map(v => Math.round(v)), mixW = (k, w) => Math.round(hot[k] + (255 - hot[k]) * w);
    const c0 = [0, 1, 2].map(k => mixW(k, Math.max(0, .75 - .9 * u))).join(), c1 = [0, 1, 2].map(k => mixW(k, Math.max(0, .3 - .45 * u))).join();   // white fades out fast as it reddens
    core.addColorStop(0, `rgba(${c0},.75)`); core.addColorStop(.35, `rgba(${c1},.42)`); core.addColorStop(1, `rgba(${hot.join()},0)`);
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(cx, cy, cr, 0, 6.29); ctx.fill();
    this.drawProminences(ctx, cx, cy, R);
    ctx.globalCompositeOperation = 'source-over';
  },

  // fiery limb (2026-10-21: "prominences look static — make them fuzzy, hairy, fiery"):
  //  · a fringe of flickering hair-like spicules all round the edge, each licking in and out on its own rhythm
  //  · prominence arches made of many turbulent strands that writhe every frame, a soft wide glow under a hot thin core
  drawProminences(ctx, cx, cy, R) {
    if (this.off('mFlames')) return;
    const t = this.time, base = this.flareColor() || this.mtex && this.mtex.outer || [255, 120, 60];
    const hot = base.map(v => Math.round(v + (255 - v) * .55)).join(), rim = base.map(Math.round).join(), r = rnd(4.2);
    const P = (a, d) => [cx + Math.cos(a) * d, cy + Math.sin(a) * d];
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // spicules: short flickering hairs, drawn tip-faded in three steps
    const turn = t * 6.2832 / SUN_TURN * .5, NS = this.lite ? 120 : 340;   // iPhone: a third of the hairs, one stroke each
    // (2026-10-28: batched — every segment goes into one path per tip step × flicker level (6 levels, an invisible
    // quantisation), so ~2,000 separate strokes a frame become ~36; each hair keeps its own length, bend and flicker)
    const FL = 6, B = [1, 2, 3].map(() => Array.from({ length: FL }, () => new Path2D()));
    for (let i = 0; i < NS; i++) {
      const ph = r() * 50, sp = 1.5 + r() * 3.5, a = i / NS * 6.2832 + (r() - .5) * .03 + turn;
      const fl = Math.max(0, .55 + .45 * Math.sin(t * sp + ph) * Math.sin(t * sp * .37 + ph * 1.7));
      const L = R * (.04 + .13 * r() * r()) * (.35 + .65 * fl), bend = .07 * Math.sin(t * 1.3 + ph);
      if (L < R * .012) continue;
      const lv = Math.min(FL - 1, Math.round(fl * (FL - 1)));
      let [x0, y0] = P(a, R * .965);
      for (let s = 1; s <= 3; s++) {
        const [x1, y1] = P(a + bend * s * s / 9, R * .965 + L * s / 3), pth = B[s - 1][lv];
        pth.moveTo(x0, y0); pth.lineTo(x1, y1); x0 = x1; y0 = y1;
      }
    }
    for (let s = 1; s <= 3; s++) for (let lv = 0; lv < FL; lv++) {
      const al = (.1 + .1 * lv / (FL - 1)) * [0, 1, .55, .22][s], pth = B[s - 1][lv];
      if (!this.lite) { ctx.strokeStyle = `rgba(${rim},${al * .35})`; ctx.lineWidth = 3.4 * (R / 90); ctx.stroke(pth); }   // soft halo → fuzzy
      ctx.strokeStyle = `rgba(${s === 1 ? hot : rim},${al})`; ctx.lineWidth = (1.1 - s * .25) * (R / 90); ctx.stroke(pth);
    }
    // prominence arches: bundles of writhing strands
    for (let j = 0; j < (this.lite ? 4 : 7); j++) {
      const a0 = r() * 6.2832 + turn, span = .08 + r() * .1, hgt = R * (.1 + r() * .16), seed = r() * 40;
      const life = Math.max(0, Math.sin(t * (.06 + r() * .05) + j * 1.9)); if (life < .05) continue;
      const pts = (k, jit) => {                                     // a strand: a quadratic arch, every point jittered by flowing noise
        const d = (k - 6) / 6, a1 = a0 - span * (1 + .3 * d), a2 = a0 + span * (1 - .25 * d), h = hgt * (1 + .4 * d) * (.85 + .15 * Math.sin(t * .8 + k));
        const out = [];
        for (let q = 0; q <= 12; q++) {
          const u = q / 12, a = a1 + (a2 - a1) * u, lift = 4 * u * (1 - u) * h * 2 * .5 + h * .1 * Math.sin(u * 9 + t * 2.2 + k);
          const wob = jit * (1 + 2 * u * (1 - u)) * (Math.sin(u * 13 + t * 3.1 + k * 2 + seed) + .6 * Math.sin(u * 29 - t * 4.7 + k * 5));
          out.push(P(a + wob * .012, R * .975 + lift + wob * R * .012));
        }
        return out;
      };
      for (let k = 0; k <= 12; k += this.lite ? 3 : 1) {
        const pt = pts(k, 1 + .5 * Math.sin(t * 2 + k)), c = 1 - Math.abs((k - 6) / 6);
        for (const [w, al, col] of [[6, .035, rim], [2.2, .07, rim], [.7, .16, hot]]) {   // soft glow, body, hot core
          ctx.strokeStyle = `rgba(${col},${al * (.4 + .6 * c) * life})`; ctx.lineWidth = w * (R / 90);
          ctx.beginPath(); ctx.moveTo(pt[0][0], pt[0][1]); for (let q = 1; q < pt.length; q++) ctx.lineTo(pt[q][0], pt[q][1]); ctx.stroke();
        }
      }
    }
    ctx.restore();
  },

  // full-res renderer's mother bubble
  // the star as an impostor (2026-10-29, the game trick — profiled: its surface strips, flames and ~340 corona hairs
  // were thousands of canvas commands a frame for something that barely changes frame to frame): drawn into its own
  // canvas 24×/s — every frame while the system is spun / tilted / zoomed — and stamped onto the scene every frame
  drawMotherCached(ctx, cx, cy, R) {
    if (this.lite || this.compact) return this.drawMother(ctx, cx, cy, R, true);
    const sc = this.dpr() * (this.cam ? this.cam.s : 1), E = R * 1.75, px = Math.ceil(2 * E * sc / 16) * 16;
    const C = this.motherImp || (this.motherImp = { cv: document.createElement('canvas'), at: -1, key: '' });
    const key = [px, Math.round(R * 10), this.sysRot, this.sysTilt].join();
    if (this.time - C.at >= 1 / 24 || key !== C.key) {
      if (C.cv.width !== px) { C.cv.width = C.cv.height = px; }
      const x = C.cv.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; x.clearRect(0, 0, px, px);
      const k = px / (2 * E); x.setTransform(k, 0, 0, k, E * k, E * k);
      this.drawMother(x, 0, 0, R, true);
      C.at = this.time; C.key = key;
    }
    ctx.drawImage(C.cv, cx - E, cy - E, 2 * E, 2 * E);
  },
  drawAttractor(dt) {
    const ctx = this.ctx, h = this.hub, t = this.time;
    if (!Number.isFinite(h.mass)) h.mass = 0;
    h.mass *= Math.pow(.6, dt);
    const R = this.motherRadius();
    // hot outer haze: soft orange corona that breathes, plus a faint shimmering ring of heat
    ctx.globalCompositeOperation = 'lighter';
    const pulse = .5 + .5 * Math.sin(t * 1.3);
    const oc = (this.flareColor() || this.mtex && this.mtex.outer || [255, 120, 60]).map(Math.round);
    const glow = ctx.createRadialGradient(h.x, h.y, R * .96, h.x, h.y, R * 1.32);             // tight bright glow hugging the limb
    glow.addColorStop(0, `rgba(${oc},${.4 + .06 * pulse})`); glow.addColorStop(.3, `rgba(${oc},.14)`); glow.addColorStop(1, `rgba(${oc},0)`);
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(h.x, h.y, R * 1.32, 0, 6.29); ctx.fill();
    const halo = ctx.createRadialGradient(h.x, h.y, R, h.x, h.y, R * 2.4);                  // and a wide, faint warm haze
    halo.addColorStop(0, `rgba(${oc},${.14 + .04 * pulse})`); halo.addColorStop(1, `rgba(${oc},0)`);
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(h.x, h.y, R * 2.4, 0, 6.29); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    this.drawMotherCached(ctx, h.x, h.y, R);
    if (this.hover === 'hub') { ctx.strokeStyle = 'rgba(255,230,210,.55)'; ctx.setLineDash([2, 6]); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(h.x, h.y, R * 1.16, t, t + 6.283); ctx.stroke(); ctx.setLineDash([]); }
  },

  // drawn after the sessions so an orbiting bubble never hides it
  drawMotherInfo() {
    if (this.compact || this.cineClean) return;   // (screen saver: a clean frame)  mini window / phone split: usage lives in the page chrome instead
    const ctx = this.ctx, h = this.hub, R = this.motherRadius();
    const below = this.hideUsage ? h.y + R * 1.22 + 4 : this.drawLimits(ctx, h.x, h.y + R * 1.22 + 8);   // Window → Show → Usage card
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(236,235,230,.85)'; ctx.font = '300 13px -apple-system, system-ui, sans-serif';
    ctx.fillText(h.ready ? `${fmtTok(h.tok)} tokens today  ·  ${h.working || 0} / ${h.count} active` : 'Reading sessions…', h.x, below + 17);
  },

  // plan usage left (what /usage shows): a compact glass card under the mother bubble; returns its bottom y
  drawLimits(ctx, cx, top) {
    const L = (this.hub.usage && this.hub.usage.limits) || [];
    const W = 214, RH = 24, H = 22 + Math.max(1, L.length) * RH, x = cx - W / 2, y = top;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.78)'; ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, W, H, 12); ctx.fill(); ctx.stroke();
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(236,235,230,.6)';
    ctx.font = '600 10.5px -apple-system, system-ui, sans-serif'; ctx.fillText('Usage left', cx, y + 14);
    if (!L.length) { ctx.fillStyle = 'rgba(220,225,255,.7)'; ctx.font = '300 11px -apple-system, system-ui, sans-serif'; ctx.fillText('loading…', cx, y + 34); ctx.restore(); return y + H; }
    L.forEach((l, i) => {
      const left = Math.max(0, 100 - l.used), ry = y + 20 + i * RH, col = limitColor(left, l);
      ctx.textAlign = 'left'; ctx.fillStyle = '#eef0ff'; ctx.font = `${l.active ? 600 : 400} 11.5px -apple-system, system-ui, sans-serif`;
      ctx.fillText(l.label, x + 12, ry + 11);
      ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(155,154,163,.9)'; ctx.font = '300 9.5px -apple-system, system-ui, sans-serif';
      ctx.fillText(fmtReset(l.resetsAt), x + W - 50, ry + 11);
      ctx.fillStyle = col; ctx.font = '600 11.5px -apple-system, system-ui, sans-serif'; ctx.fillText(Math.round(left) + '%', x + W - 12, ry + 11);
      ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(x + 12, ry + 16, W - 24, 2.5);
      ctx.fillStyle = col; ctx.fillRect(x + 12, ry + 16, (W - 24) * left / 100, 2.5);
    });
    ctx.restore();
    return y + H;
  },
});
