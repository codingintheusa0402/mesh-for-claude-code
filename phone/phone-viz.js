// iPhone: the phone shows no mesh animation (decision 2026-11-15), so it no longer loads the mesh engine (mesh, star,
// bubbles, organism, probe, black hole, Endurance, sun, three.js: 13 scripts and 2 WebGL contexts that never drew).
// This stub keeps the few things phone.js still needs: the colour tables and a no-op `viz`. (2026-11-20 cleanup)
const FAMILY_COLOR = { fable: '#ff5c8a', mythos: '#ff5c8a', opus: "#7d7bff", sonnet: "#2ef0a8", haiku: '#ffb347', other: '#9fb4d8' };
const HEALTH_COLOR = { working: '#7dffc4', idle: '#7c86b8', quiet: '#ffcf6b', waiting: '#ffcf6b', error: '#ff6b7d' };
class Mesh {
  constructor() { this.cam = { s: 1, ts: 1, tx: 0, ty: 0, ttx: 0, tty: 0 }; this.nodes = new Map(); this.sunSid = null; this.selected = null; }
  update(snap) { this.sunSid = (snap && snap.sun) || null; }
  resize() { } wake() { } clampCam() { } toggleGroup() { }
  hit() { return null; } sunNode() { return null; }
}
