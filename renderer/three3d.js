// three3d.js — the two real-3-D objects in the mesh, rendered live with WebGL (three.js r186, vendor/three) into their
// own small canvases that endurance.js / blackhole.js draw into the 2-D mesh each frame (2026-10-27: "make them 3-D
// like the probe, different views from every perspective"). If WebGL or this module fails, those files fall back to
// their 2-D versions.
//   window.Mesh3D.end — the Endurance: the Blender model (assets/endurance: build_endurance.py → bake_endurance.py, its
//     paint / panel seams / dents / grime / worn edges baked into albedo, normal, roughness and emission maps), lit by a
//     fixed sun with soft shadow-mapped self-shadowing, a cool fill and a rim. It spins about its own axis while the axis
//     itself swings slowly through face-on, oblique, near edge-on and back views; dragging it turns it by hand.
//   window.Mesh3D.bh — the black hole: a fragment shader that ray-traces every pixel along the bent light path around a
//     Schwarzschild hole (the photon-orbit equation x'' = -1.5·h²·x/r⁵) and picks up the accretion disk each time the
//     ray crosses its plane — so the Gargantua look (the far side of the disk lensed over the top, its underside as a
//     ring below, the thin photon ring, the dark shadow) is real geometry and changes properly with the viewing angle.
//     The disk is streaky gas sheared by Kepler rotation (inner faster), hotter inside, Doppler-beamed (the side coming
//     at you brighter) and gravitationally redshifted near the hole.
// (the vendored copies import each other by relative path: the app's CSP allows no inline import map)
import * as THREE from './vendor/three/three.module.js';
import { GLTFLoader } from './vendor/three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from './vendor/three/addons/loaders/DRACOLoader.js';

const LITE = /iPhone|iPad/.test(navigator.userAgent);
const mkRenderer = owner => {
  const r = new THREE.WebGLRenderer({ alpha: true, antialias: !LITE, premultipliedAlpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  r.setClearColor(0x000000, 0); r.setPixelRatio(1);
  // the GPU dropped the context (sleep, a driver reset): this object falls back to its 2-D drawing from then on
  r.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); if (owner) owner.ready = false; console.warn('[3D] WebGL context lost'); });
  return r;
};
// drawing-buffer sizes snap to 32 px steps: a size that drifts every frame (camera drift, zoom easing) would make the GPU
// reallocate the buffer every frame (profiled 2026-10-29); callers draw the result into their own box, so a few px of
// slack don't show
const snap32 = v => Math.max(32, Math.ceil(v / 32) * 32);
const sizeTo = (R, w, h) => { w = snap32(w); h = snap32(h); const c = R.domElement; if (c.width !== w || c.height !== h) R.setSize(w, h, false); };

// ------------------------------------------------------------------ the Endurance
const end = { ready: false };
try {
  const R = mkRenderer(end);
  R.outputColorSpace = THREE.SRGBColorSpace; R.toneMapping = THREE.AgXToneMapping; R.toneMappingExposure = 1.4;
  R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(28, 1, .1, 50);
  cam.position.set(0, 0, 5.6); cam.lookAt(0, 0, 0);
  const sun = new THREE.DirectionalLight(0xfff4e6, 3.6); sun.position.set(-3.4, 2.6, 2.6); sun.castShadow = true;
  const sc = sun.shadow.camera; sc.left = sc.bottom = -1.5; sc.right = sc.top = 1.5; sc.near = .5; sc.far = 12;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -.0004; sun.shadow.normalBias = .012; sun.shadow.radius = 2;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xb4c4ff, .55); fill.position.set(2.6, -1.8, 1.4); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xd6e2ff, 1.3); rim.position.set(1.6, 2, -3.2); scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x95a3c4, 0x121419, .75));
  const tilt = new THREE.Group(), spin = new THREE.Group(); tilt.add(spin); scene.add(tilt);
  const qBase = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);   // model axis (+Y) → toward the camera
  const qYaw = new THREE.Quaternion(), qPitch = new THREE.Quaternion(), qN = new THREE.Quaternion(), qT = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), nAx = new THREE.Vector3();
  const draco = new DRACOLoader(); draco.setDecoderPath(new URL('vendor/three/addons/libs/draco/gltf/', document.baseURI).href);
  const gl = new GLTFLoader(); gl.setDRACOLoader(draco);
  gl.load(new URL('endurance/endurance.glb', document.baseURI).href, g => {
    g.scene.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      const m = o.material; for (const k of ['map', 'normalMap', 'roughnessMap', 'emissiveMap']) if (m[k]) m[k].anisotropy = Math.min(8, R.capabilities.getMaxAnisotropy());
      if (m.normalMap) m.normalScale.set(1, 1);
    });
    spin.add(g.scene); end.ready = true;
  }, undefined, e => console.warn('[Endurance 3D] model failed:', e && e.message));
  const v = new THREE.Vector3(), c0 = new THREE.Vector3();
  Object.assign(end, {
    canvas: R.domElement,
    // o = { px: canvas size in device px, spin: rad about its axis, yaw, pitch: how the axis is turned }
    render(o) {
      sizeTo(R, o.px, o.px);
      qYaw.setFromAxisAngle(Y, o.yaw); qPitch.setFromAxisAngle(X, o.pitch);
      // a body in the orbit plane: the system's spin turns it about the plane's normal n = (0, cos e, sin e) (e = the
      // plane's elevation, sin e = k), a tilt of the plane pitches it about the screen's horizontal
      const k = o.k ?? .4; nAx.set(0, Math.sqrt(Math.max(0, 1 - k * k)), k).normalize();
      qN.setFromAxisAngle(nAx, o.sysRot || 0); qT.setFromAxisAngle(X, o.sysTilt || 0);
      tilt.quaternion.copy(qN).multiply(qT).multiply(qYaw).multiply(qPitch).multiply(qBase);
      spin.rotation.y = -o.spin;
      R.render(scene, cam);
      return R.domElement;
    },
    // a point in model space (glTF: +Y = the station axis) → canvas NDC (-1..1, y up) + whether it's on the near side
    project(x, y, z) {
      spin.updateWorldMatrix(true, false);
      v.set(x, y, z).applyMatrix4(spin.matrixWorld); const near = v.z > 0;
      v.project(cam); return { x: v.x, y: v.y, near };
    },
  });
} catch (e) { console.warn('[Endurance 3D] off:', e && e.message); }

// ------------------------------------------------------------------ the black hole
const bh = { ready: false };
try {
  const R = mkRenderer(bh); R.outputColorSpace = THREE.LinearSRGBColorSpace; R.toneMapping = THREE.NoToneMapping;
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const U = { uRes: { value: new THREE.Vector2(2, 2) }, uF: { value: 100 }, uDist: { value: 60 }, uCam: { value: new THREE.Vector3() }, uFw: { value: new THREE.Vector3() }, uRt: { value: new THREE.Vector3() }, uUp: { value: new THREE.Vector3() }, uPhase: { value: 0 }, uGain: { value: 1 } };
  const STEPS = LITE ? 120 : 160;          // (2026-10-29: 220 → 160; rays exit early on hit / escape)
  const mat = new THREE.ShaderMaterial({
    uniforms: U, depthTest: false, depthWrite: false, blending: THREE.NoBlending, transparent: true,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: `
precision highp float;
varying vec2 vUv;
uniform vec2 uRes; uniform float uF, uDist, uPhase, uGain; uniform vec3 uCam, uFw, uRt, uUp;
const float RIN = 2.6, ROUT = 16.0, RH = 2.0;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float a = .5, s = 0.; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
// the disk where the ray crosses its plane: colour (premultiplied) and opacity
vec4 disk(vec3 c, vec3 dir) {
  float r = length(c.xz);
  if (r < RIN || r > ROUT) return vec4(0.);
  float phi = atan(c.z, c.x);
  float ph = phi - uPhase * 2.4 * pow(r / RIN, -1.5);                      // Kepler: the inner gas laps the outer
  vec2 q = vec2(cos(ph), sin(ph));
  float n = fbm(vec2(r * 2.3, 0.) + q * 2.1) * .7 + fbm(vec2(r * 7.5, 3.) + q * 5.5) * .45;   // streaks along the orbit
  float lanes = smoothstep(.25, .75, fbm(vec2(r * 1.3, 9.) + q * 1.4));
  float dens = smoothstep(RIN, RIN + 1.4, r) * (1. - smoothstep(ROUT * .5, ROUT, r)) * clamp(.15 + 1.05 * n * (.55 + .45 * lanes), 0., 1.);
  float hot = pow(RIN / r, .85);
  vec3 col = mix(vec3(1., .42, .12), vec3(1., .96, .88), hot * hot);                  // gold-amber outside, white-hot inside
  float I = 3.6 * pow(RIN / r, 1.4);
  // Doppler beaming: the gas orbits (counter-clockwise seen from +y); light reaching us travels along -dir
  float v = clamp(.62 / sqrt(max(r - 1.6, .3)), 0., .62);
  vec3 t = vec3(-sin(phi), 0., cos(phi));
  float g = 1. / (inversesqrt(1. - v * v) * (1. - v * dot(t, -dir)));
  I *= clamp(pow(g, 3.), .12, 4.5) * sqrt(max(1. - RH / r, .05));
  return vec4(col * I * dens, dens * .92);
}
void main() {
  vec2 px = (vUv - .5) * uRes;
  vec3 p = uCam, v = normalize(uFw * uF + uRt * px.x + uUp * px.y);       // the camera can sit anywhere round the hole
  vec3 L = cross(p, v); float h2 = dot(L, L);
  vec3 col = vec3(0.); float a = 0.;
  for (int i = 0; i < ${STEPS}; i++) {
    float r = length(p);
    float dt = clamp(${LITE ? '.085' : '.055'} * r, .03, 1.6);
    v += -1.5 * h2 * p / pow(r, 5.) * dt;                                  // bend the ray
    vec3 pn = p + v * dt;
    float rr = length(pn.xz), hz = .07 * rr + .12;                         // the disk has a little thickness: hazy, fluffy gas
    if (rr > RIN && rr < ROUT && abs(pn.y) < hz * 2.5) {
      vec4 d = disk(vec3(pn.x, 0., pn.z), normalize(v));
      float f = exp(-pn.y * pn.y / (hz * hz)) * min(dt, .5) * .022;
      col += (1. - a) * d.rgb * f; a += (1. - a) * d.a * f * .6;
    }
    if (p.y * pn.y < 0.) {                                                  // crossed the disk plane
      vec3 c = mix(p, pn, p.y / (p.y - pn.y));
      vec4 d = disk(c, normalize(v));
      col += (1. - a) * d.rgb; a += (1. - a) * d.a;
    }
    p = pn;
    if (dot(p, p) < RH * RH) { a = 1.; break; }                            // fell in: the shadow
    if (r > uDist * 1.25 && dot(p, v) > 0.) break;                           // escaped
    if (a > .985) break;
  }
  col *= uGain;
  col = 1. - exp(-col * 1.5);                                              // soft shoulder, then display gamma
  col = pow(col, vec3(1. / 2.2));
  gl_FragColor = vec4(col, a);
}`,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  Object.assign(bh, {
    ready: true, canvas: R.domElement, RS: 5.196, ROUT: 16,
    // o = { w, h: canvas device px, k: device px per unit at the hole, cam: { fw, rt, up } unit vectors in the disk's frame
    //       (disk in the xz plane, pole +y; the camera sits at -fw·60 looking in), phase, gain }
    render(o) {
      sizeTo(R, o.w, o.h);
      U.uRes.value.set(R.domElement.width, R.domElement.height); U.uDist.value = 60; U.uF.value = o.k * 60;
      const c = o.cam; U.uFw.value.fromArray(c.fw); U.uRt.value.fromArray(c.rt); U.uUp.value.fromArray(c.up); U.uCam.value.fromArray(c.fw).multiplyScalar(-60);
      U.uPhase.value = o.phase; U.uGain.value = o.gain;
      R.render(scene, cam);
      return R.domElement;
    },
  });
} catch (e) { console.warn('[black hole 3D] off:', e && e.message); }

// ------------------------------------------------------------------ the build bay: a new probe made on the Endurance
// (2026-10-27) When the probe is lost (swallowed by the black hole, or it couldn't break free of the mother star) the
// Endurance builds a new one in 60 s, shown live at its docking hub: the bay powers up, the shell is 3-D printed layer
// by layer (a glowing print line rising through it), the face, jaw, side brackets, pods, clamp arms and engine fly in
// carried in by two robot arms (tentacle-fingered heads) and welded on (sparks, flickering arc light); three sintering
// lasers from the station work the print line; the arms then spray-paint it (mist cones) turning the grey primer
// into the new colour scheme (same shape, the hue turned per generation), it powers on (eye, LEDs, engine), spins once
// for a systems check and lifts off. The parts are the real probe model (assets/probe/bake_probe.py → probe.glb).
const build = { ready: false, T: 60 };
try {
  const R = mkRenderer(build);
  R.outputColorSpace = THREE.SRGBColorSpace; R.toneMapping = THREE.AgXToneMapping; R.toneMappingExposure = 1.3; R.localClippingEnabled = true;
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(32, 1, .05, 40);
  scene.add(new THREE.HemisphereLight(0xa8b8e0, 0x14161c, .7));
  const key = new THREE.DirectionalLight(0xfff2e2, 2.6); key.position.set(-2.5, 3, 2.5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 1.4); rim.position.set(2, 1.5, -3); scene.add(rim);
  const arc = new THREE.PointLight(0xffb070, 0, 3, 2); scene.add(arc);                  // the welding arc / the sintering hot spot
  const eyeLight = new THREE.PointLight(0xff9a30, 0, 2.5, 2); eyeLight.position.set(0, 0, .5); scene.add(eyeLight);
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3f48, metalness: .8, roughness: .38 });
  const tentMat = new THREE.MeshStandardMaterial({ color: 0x8a9099, metalness: .9, roughness: .3 });
  const lightStrip = new THREE.MeshBasicMaterial({ color: 0x6fd8ff });
  const addMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  // the bay: a ring platform under the build, light strips, a faint holo floor
  const bay = new THREE.Group(); scene.add(bay);
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, .08, 48), metal); deck.position.y = -.92; deck.visible = false;   // (2026-10-29: no floor plate — Kevin)
  const glow = new THREE.Mesh(new THREE.TorusGeometry(1.08, .012, 8, 96), lightStrip); glow.rotation.x = Math.PI / 2; glow.position.y = -.87;
  const holo = new THREE.Mesh(new THREE.CircleGeometry(.95, 64), addMat(0x3fb8ff, .12)); holo.rotation.x = -Math.PI / 2; holo.position.y = -.875;
  // a thin beam / a spray cone between two points
  const UP = new THREE.Vector3(0, 1, 0), dir3 = new THREE.Vector3();
  const place = (m, a, b, spread) => {
    dir3.subVectors(b, a); const L = dir3.length() || .001; m.position.copy(a).addScaledVector(dir3, .5);
    m.quaternion.setFromUnitVectors(UP, dir3.normalize()); m.scale.set(spread || 1, L, spread || 1); m.visible = true;
  };
  const mkBeam = (color, r) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 8, 1, true), addMat(color, .85)); m.visible = false; scene.add(m); return m; };
  const printBeams = [0, 1].map(() => [mkBeam(0xb49bff, .02), mkBeam(0xffffff, .006)]), streams = [0, 1].map(() => mkBeam(0xff9a3c, .016));
  const lasers = [0, 1, 2].map(() => mkBeam(0xaef4ff, .006)), laserSrc = [new THREE.Vector3(-1.7, 2.7, 1.1), new THREE.Vector3(1.9, 2.5, .6), new THREE.Vector3(.2, 2.9, -1.8)];
  const scanDisc = new THREE.Mesh(new THREE.CylinderGeometry(.78, .78, .006, 64), addMat(0x7fe8ff, .35)); scanDisc.visible = false; scene.add(scanDisc);
  const sprayCones = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.ConeGeometry(.16, 1, 20, 1, true), addMat(0xffffff, .16)); m.geometry.translate(0, -.5, 0); m.geometry.rotateX(Math.PI); m.visible = false; scene.add(m); return m; });
  // two industrial robot arms (2026-10-29, after Kevin's reference: glossy yellow shell, stacked sphere joints with dark
  // bolted side caps, a long flat upper link with a black band and a copper cable, a telescoping tool barrel with black
  // rings, a gripper with a welding needle; star-shaped base with black handles). They're mounted on the Endurance's
  // hub (`mount`), which turns with the station's spin — the arms ride round the build and their IK keeps the tools on
  // the work; they rise out of hatches in the deck at the start and fold back in after lift-off.
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xffb300, metalness: .1, roughness: .32, emissive: 0x3a2200, emissiveIntensity: .5, clearcoat: .85, clearcoatRoughness: .22 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x24272c, metalness: .7, roughness: .42 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0f1012, metalness: .1, roughness: .6 });
  const copper = new THREE.MeshStandardMaterial({ color: 0xc07a3c, metalness: 1, roughness: .3 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 1, roughness: .14 });
  const mount = new THREE.Group(); bay.add(mount);
  const starGeo = (() => {                                                     // the 4-lobed base plate
    const sh = new THREE.Shape(), N = 120;
    for (let i = 0; i <= N; i++) { const a = i / N * Math.PI * 2, r = .13 + .13 * Math.pow(Math.abs(Math.cos(2 * a)), 2.2); i ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    const g = new THREE.ExtrudeGeometry(sh, { depth: .045, bevelEnabled: true, bevelThickness: .01, bevelSize: .01, bevelSegments: 2, curveSegments: 4 });
    g.rotateX(-Math.PI / 2); return g;
  })();
  const capDisc = (r, parent, x) => {                                         // a dark bolted side cap on a joint sphere
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, .014, 28), dark); c.rotation.z = Math.PI / 2; c.position.x = x; parent.add(c);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * .35, r * .35, .02, 16), chrome); hub.rotation.z = Math.PI / 2; hub.position.x = x + Math.sign(x) * .004; parent.add(hub);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, b = new THREE.Mesh(new THREE.SphereGeometry(.0055, 6, 4), chrome); b.position.set(x + Math.sign(x) * .008, Math.cos(a) * r * .68, Math.sin(a) * r * .68); parent.add(b); }
  };
  const link = (len, w, d, parent, x) => {                                    // a flat rounded link, from y=0 up to y=len
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(w / 2, len, 6, 16), paint); m.scale.z = d / w; m.position.set(x, len / 2, 0); parent.add(m); return m;
  };
  const mkArm = ang => {
    const RR = .92, root = new THREE.Group(); root.position.set(Math.cos(ang) * RR, -.88, Math.sin(ang) * RR); mount.add(root);
    const hatch = new THREE.Mesh(new THREE.CylinderGeometry(.24, .24, .012, 40), rubber); hatch.position.set(root.position.x, -.875, root.position.z);
    const hatchRing = new THREE.Mesh(new THREE.TorusGeometry(.245, .006, 6, 48), lightStrip); hatchRing.rotation.x = Math.PI / 2; hatchRing.position.copy(hatch.position).y += .008;
    const plate = new THREE.Mesh(starGeo, paint); plate.position.y = -.005; root.add(plate);
    const turn = new THREE.Mesh(new THREE.CylinderGeometry(.115, .125, .035, 32), dark); turn.position.y = .058; root.add(turn);
    for (let i = 0; i < 4; i++) {                                             // handles + bolt hubs on the lobes
      const a = i / 4 * Math.PI * 2 + Math.PI / 4, h = new THREE.Mesh(new THREE.TorusGeometry(.032, .006, 8, 16, Math.PI), rubber);
      h.position.set(Math.cos(a) * .15, .05, Math.sin(a) * .15); h.rotation.y = -a + Math.PI / 2; root.add(h);
      const hb = new THREE.Mesh(new THREE.CylinderGeometry(.022, .026, .02, 14), chrome); hb.position.set(Math.cos(a - Math.PI / 4) * .2, .06, Math.sin(a - Math.PI / 4) * .2); root.add(hb);
    }
    const yaw = new THREE.Group(); yaw.position.y = .14; root.add(yaw);
    const waist = new THREE.Mesh(new THREE.SphereGeometry(.12, 28, 20), paint); waist.position.y = -.045; yaw.add(waist);
    const sh = new THREE.Group(); yaw.add(sh);
    const L1 = .85, L2 = .75;
    sh.add(new THREE.Mesh(new THREE.SphereGeometry(.14, 28, 20), paint)); capDisc(.085, sh, .14); capDisc(.085, sh, -.14);
    link(L1, .11, .065, sh, .155);                                           // the long upper link beside the joints
    const band = new THREE.Mesh(new THREE.BoxGeometry(.125, .02, .078), rubber); band.position.set(.155, L1 * .55, 0); sh.add(band);
    const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(.21, .05, .03), new THREE.Vector3(.24, L1 * .4, .05), new THREE.Vector3(.22, L1 * .85, .04), new THREE.Vector3(.1, L1 + .02, .05)]), 24, .007, 6), copper); sh.add(cable);
    const el = new THREE.Group(); el.position.y = L1; sh.add(el);
    el.add(new THREE.Mesh(new THREE.SphereGeometry(.125, 28, 20), paint)); capDisc(.075, el, .125); capDisc(.075, el, -.125);
    link(L2 * .3, .09, .055, el, -.125);
    const wrist = new THREE.Mesh(new THREE.SphereGeometry(.095, 24, 18), paint); wrist.position.y = L2 * .34; el.add(wrist);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.036, .04, L2 * .5, 18), dark); barrel.position.y = L2 * .62; el.add(barrel);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(.021, .021, L2 * .2, 14), chrome); inner.position.y = L2 * .9; el.add(inner);
    for (const y of [.46, .56, .7, .82]) { const r = new THREE.Mesh(new THREE.TorusGeometry(.043, .008, 8, 24), rubber); r.rotation.x = Math.PI / 2; r.position.y = L2 * y; el.add(r); }
    const head = new THREE.Group(); head.position.y = L2; el.add(head);
    const block = new THREE.Mesh(new THREE.BoxGeometry(.06, .05, .05), paint); block.position.y = .01; head.add(block);
    const jaws = [-1, 1].map(sg => { const p = new THREE.Group(); p.position.set(sg * .024, .035, 0); head.add(p); const j = new THREE.Mesh(new THREE.BoxGeometry(.012, .05, .03), dark); j.position.y = .025; p.add(j); return { p, sg }; });
    const needle = new THREE.Mesh(new THREE.CylinderGeometry(.0025, .0012, .07, 6), chrome); needle.position.y = .07; head.add(needle);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(.012, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff0d0 })); tip.position.y = .105; head.add(tip);
    const nozzle = new THREE.Mesh(new THREE.ConeGeometry(.02, .07, 12), dark); nozzle.position.y = .1; nozzle.visible = false; head.add(nozzle);
    return { root, ang, yaw, sh, el, L1, L2, tip, nozzle, jaws, curl: 0, cur: new THREE.Vector3(Math.cos(ang) * .9, -.4, Math.sin(ang) * .9) };
  };
  const arms = [mkArm(Math.PI * .95), mkArm(Math.PI * .05)];
  const v3 = new THREE.Vector3(), w3 = new THREE.Vector3(), u3 = new THREE.Vector3();
  const aim = (A, target, dt, speed) => {                                    // 2-link IK toward the (eased) target
    A.cur.lerp(target, Math.min(1, dt * (speed || 3)));
    A.root.updateWorldMatrix(true, false); v3.copy(A.cur); A.root.worldToLocal(v3); v3.y -= .14;
    A.yaw.rotation.y = Math.atan2(v3.x, v3.z);
    const d = Math.min(A.L1 + A.L2 - .02, Math.max(.2, v3.length())), h = Math.hypot(v3.x, v3.z), elev = Math.atan2(v3.y, h);
    const c1 = (A.L1 * A.L1 + d * d - A.L2 * A.L2) / (2 * A.L1 * d), c2 = (A.L1 * A.L1 + A.L2 * A.L2 - d * d) / (2 * A.L1 * A.L2);
    A.sh.rotation.x = Math.PI / 2 - elev - Math.acos(Math.max(-1, Math.min(1, c1)));
    A.el.rotation.x = Math.PI - Math.acos(Math.max(-1, Math.min(1, c2)));
  };
  const pose = (A, curl, t, dt) => {                                           // the gripper: 0 = open, 1 = closed on a part
    A.curl += (curl - A.curl) * Math.min(1, dt * 6);
    for (const J of A.jaws) J.p.rotation.z = J.sg * (.55 * (1 - A.curl) - .05);
  };
  // sparks (welding / sintering / exhaust) and paint mist: two point clouds
  const cloud = (N, color, size) => {
    const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), life = new Float32Array(N), geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false })); scene.add(pts);
    const C = { N, pos, vel, life, geo, pts, next: 0, g: 3.2 };
    C.emit = (p, n, base, spread, lifeS) => { for (let i = 0; i < n; i++) { const j = C.next++ % N; pos.set([p.x, p.y, p.z], j * 3); vel.set([(base ? base.x : 0) + (Math.random() - .5) * spread, (base ? base.y : Math.random() * 1.6) + (Math.random() - .5) * spread, (base ? base.z : 0) + (Math.random() - .5) * spread], j * 3); life[j] = lifeS + Math.random() * lifeS; } };
    C.step = dt => { for (let j = 0; j < N; j++) { if (life[j] <= 0) { pos[j * 3 + 1] = -99; continue; } life[j] -= dt; vel[j * 3 + 1] -= dt * C.g; for (let k = 0; k < 3; k++) pos[j * 3 + k] += vel[j * 3 + k] * dt; } geo.attributes.position.needsUpdate = true; };
    return C;
  };
  const sparks = cloud(LITE ? 120 : 260, 0xffc070, .028), mist = cloud(LITE ? 300 : 700, 0xffffff, .05); mist.g = .15;
  // the print line rising through the shell, the paint line
  const printRing = new THREE.Mesh(new THREE.TorusGeometry(1, .012, 8, 96), addMat(0x8ff0ff, 1)); printRing.rotation.x = Math.PI / 2; scene.add(printRing);
  const paintRing = new THREE.Mesh(new THREE.TorusGeometry(1, .02, 8, 96), addMat(0xffffff, .7)); paintRing.rotation.x = Math.PI / 2; scene.add(paintRing);
  // the probe, part groups; its material gets primer → paint (hue turned) and power (emission) controls
  const U = { uHue: { value: 0 }, uPaintY: { value: 2 }, uPower: { value: 0 }, uPrintY: { value: -9 } };
  const patch = m => {
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWP; uniform float uHue, uPaintY, uPower, uPrintY;
vec3 hueRot(vec3 c, float a) { const mat3 toY = mat3(.299, .596, .211, .587, -.274, -.523, .114, -.322, .312);
  const mat3 toR = mat3(1., 1., 1., .956, -.272, -1.106, .621, -.647, 1.703); vec3 y = toY * c; float h = atan(y.z, y.y) + a, ch = length(y.yz);
  return max(vec3(0.), toR * vec3(y.x, ch * cos(h), ch * sin(h))); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
{ float l = dot(diffuseColor.rgb, vec3(.299, .587, .114)); vec3 primer = vec3(l * .5 + .2);
  float pm = smoothstep(uPaintY - .05, uPaintY + .05, vWP.y); diffuseColor.rgb = mix(primer, hueRot(diffuseColor.rgb, uHue), pm); }`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= uPower;\n{ float h = uPrintY - vWP.y; float heat = h >= 0. ? exp(-h * 38.) : 0.; totalEmissiveRadiance += vec3(1., .42, .1) * heat * 2.4; }');
    };
    m.customProgramCacheKey = () => 'probeBuild';
  };
  const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), -1);
  // the parts, in order: [group, from, to, direction they come in from]; the arm on that side carries each one in
  const G = {}, ORDER = [['face', 14, 18.5, [0, .1, 1]], ['jaw', 18.5, 22, [0, -1, .4]], ['bracketL', 22, 25, [1, .2, 0]], ['bracketR', 23.2, 26.2, [-1, .2, 0]],
    ['podL', 26.2, 29.6, [1, .3, -.2]], ['podR', 27.6, 31, [-1, .3, -.2]], ['clamp', 31, 34, [0, 1, -.3]], ['engine', 34, 39, [0, .1, -1]]];
  const probe = new THREE.Group(); scene.add(probe);
  const draco = new DRACOLoader(); draco.setDecoderPath(new URL('vendor/three/addons/libs/draco/gltf/', document.baseURI).href);
  const gl = new GLTFLoader(); gl.setDRACOLoader(draco);
  gl.load(new URL('probe/probe.glb', document.baseURI).href, g => {
    let shellMat = null, partMat = null;
    g.scene.traverse(o => {
      if (!o.isMesh) return;
      const shell = o.parent && o.parent.name === 'G_shell';
      if (!partMat) { partMat = o.material; partMat.clippingPlanes = [clip]; patch(partMat); shellMat = partMat.clone(); shellMat.clippingPlanes = [clip]; patch(shellMat); }
      o.material = shell ? shellMat : partMat;
    });
    for (const c of [...g.scene.children]) if (c.name && c.name.startsWith('G_')) { G[c.name.slice(2)] = c; probe.add(c); }
    // the print: bottom to top over the whole model; slice radius per height (from the vertices) for the print heads
    probe.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(probe); PR.y0 = bb.min.y; PR.y1 = bb.max.y;
    const NB = 48, rad = new Float32Array(NB), vv = new THREE.Vector3();
    probe.traverse(o => { if (!o.isMesh) return; const pos = o.geometry.attributes.position; for (let i = 0; i < pos.count; i += 3) { vv.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); const b = Math.max(0, Math.min(NB - 1, Math.floor((vv.y - PR.y0) / (PR.y1 - PR.y0) * NB))); rad[b] = Math.max(rad[b], Math.hypot(vv.x, vv.z)); } });
    PR.rad = rad;
    build.ready = !!G.shell;
  }, undefined, e => console.warn('[build bay] probe model failed:', e && e.message));
  const PR = { y0: -.6, y1: .6, rad: null };
  const ease = u => u < 0 ? 0 : u > 1 ? 1 : 1 - Math.pow(1 - u, 3), clamp01 = v => Math.max(0, Math.min(1, v));
  let lastT = 0, lastSpin = null;
  const tgt = [new THREE.Vector3(), new THREE.Vector3()], curl = [0, 0];
  Object.assign(build, {
    canvas: R.domElement,
    // o = { t: seconds into the build (0…60), px: canvas size in device px, hue: degrees }
    // 0–3 the arms unfold · 3–40 the whole probe is 3-D printed bottom to top by the two arms (UV laser + molten stream)
    // · 41–49 spray paint · 49–53 power on · 53–57 scan · 57–60 lift-off
    render(o) {
      sizeTo(R, o.px, o.px);
      const t = o.t, dt = Math.max(0, Math.min(.1, t - lastT)) || .016; lastT = t;
      // the camera: a slow drift round the bay, plus the system's spin (turns the bay about its vertical, like every body
      // in the orbit plane) and tilt (raises / lowers the view) — so spinning / tilting the mesh turns the bay with it
      const ca = .55 + t * .03 - (o.sysRot || 0), el = Math.max(-.35, Math.min(1.25, .345 + (o.sysTilt || 0) * 2.2 + (o.elev || 0))), D = 5.6;
      cam.position.set(Math.sin(ca) * Math.cos(el) * D, Math.sin(el) * D, Math.cos(ca) * Math.cos(el) * D); cam.lookAt(0, -.12, 0);
      // the print (2026-10-29, Kevin: "build from bottom to top like a 3-D printer"): 3–40 s the whole probe rises layer by
      // layer; the two arms are the print heads — each runs its tool round its side of the current layer, a UV curing
      // laser and a molten stream from the tip to the deposit point; the fresh layer glows hot and cools (shader uPrintY)
      const pu = clamp01((t - 3) / 37), py = PR.y0 - .01 + (PR.y1 - PR.y0 + .02) * pu, printing = pu > 0 && pu < 1;
      clip.constant = t < 3 ? PR.y0 - .05 : py; U.uPrintY.value = printing ? py : -9;
      const sliceR = PR.rad ? Math.max(.04, PR.rad[Math.max(0, Math.min(PR.rad.length - 1, Math.floor((py - PR.y0) / (PR.y1 - PR.y0) * PR.rad.length)))]) : Math.sqrt(Math.max(.002, .25 - py * py));
      printRing.visible = printing; printRing.position.y = py; printRing.scale.setScalar(sliceR); printRing.material.color.setRGB(1, .55, .2);
      arc.intensity = 0; lasers.forEach(m => { m.visible = false; });
      for (const grp of Object.values(G)) { grp.visible = true; grp.position.set(0, 0, 0); grp.rotation.set(0, 0, 0); }
      // the arms ride the Endurance's spin (the hub turns; their bases go round the build)
      const spinA = -(o.endSpin || 0), om = lastSpin == null ? 0 : (spinA - lastSpin) / dt; lastSpin = spinA;
      mount.rotation.y = spinA;
      const rootW = arms.map(A => A.root.getWorldPosition(new THREE.Vector3()));
      // paint: both arms spray from opposite sides, going round the probe at the paint line's height (top → bottom)
      const paint = clamp01((t - 41) / 8), spraying = paint > 0 && paint < 1;
      U.uPaintY.value = 1.2 - 2.4 * paint; U.uHue.value = (o.hue || 0) * Math.PI / 180;
      paintRing.visible = spraying; paintRing.position.y = U.uPaintY.value; paintRing.scale.setScalar(.62);
      mist.pts.material.color.setHSL(((o.hue || 0) / 360 + .58) % 1, .75, .62);   // (the probe's blue, turned by the hue)
      // power on (eye + LEDs flicker then hold), the scan, lift-off
      U.uPower.value = clamp01((t - 49) / 4) * (.85 + .15 * Math.sin(t * 30) * (t < 53 ? 1 : 0));
      eyeLight.intensity = U.uPower.value * 1.4;
      const scan = clamp01((t - 53) / 4); scanDisc.visible = scan > 0 && scan < 1; scanDisc.position.y = .7 - 1.4 * Math.abs(1 - 2 * ((scan * 2) % 1)) * 1; scanDisc.material.opacity = .3 + .15 * Math.sin(t * 20);
      const chk = clamp01((t - 54) / 6); probe.rotation.y = ease(chk) * Math.PI * 2; probe.position.y = ease((t - 57) / 3) * .45;
      if (t > 57) { w3.set(0, probe.position.y - .5, 0); sparks.emit(w3, LITE ? 2 : 4, u3.set(0, -2.6, 0), 1.1, .3); }   // exhaust
      // the arms: out of the deck in the first 3 s, back in after lift-off
      const dep = ease(t / 3.5) * (1 - ease((t - 57.5) / 2.5));
      arms.forEach((A, i) => {
        A.root.position.y = -.88; A.root.scale.setScalar(Math.max(.001, dep));   // unfolds out of the Endurance (no deck to rise through)
        // the spin's physics: a slight lean out (centrifugal) and the tool trailing the turn (inertia)
        A.root.rotation.set(0, 0, 0); A.root.rotateOnWorldAxis(u3.set(-Math.sin(A.ang), 0, Math.cos(A.ang)), -.06 * Math.min(1, Math.abs(om) * 4));
        const rw = rootW[i], ra = Math.atan2(rw.z, rw.x);
        let target, c = 0, speed = 3;
        let dep3 = null;
        if (printing) {                                                          // the print head: round its side of the layer
          const ph = ra + Math.sin(t * 2.6 + i * 1.7) * 1.25; dep3 = new THREE.Vector3(Math.cos(ph) * sliceR, py, Math.sin(ph) * sliceR);
          target = tgt[i].set(Math.cos(ph) * (sliceR + .16), py + .2, Math.sin(ph) * (sliceR + .16)); c = .3; speed = 9;
        }
        else if (spraying) { const ph = ra + Math.sin(t * 1.8 + i) * .5; target = tgt[i].set(Math.cos(ph) * .98, U.uPaintY.value + .12, Math.sin(ph) * .98); c = .85; speed = 8; }
        else if (t >= 41) target = tgt[i].set(Math.cos(ra) * .55, -.25, Math.sin(ra) * .55);
        else target = tgt[i].set(Math.cos(ra) * .45, .35 + .1 * Math.sin(t * 1.3 + i), Math.sin(ra) * .45);
        target = target.clone().add(u3.set(Math.sin(ra), 0, -Math.cos(ra)).multiplyScalar(om * .35));   // trails the turn
        aim(A, target, dt, speed); pose(A, c, t, dt); A.nozzle.visible = spraying || printing;
        const [laser, core] = printBeams[i];
        if (dep3) {                                                             // UV laser + molten stream to the deposit point, droplets, glow
          A.tip.getWorldPosition(w3);
          place(laser, w3, dep3, 1 + .4 * Math.random()); laser.material.opacity = .5 + .3 * Math.random(); place(core, w3, dep3, 1); core.material.opacity = .9;
          place(streams[i], w3, dep3, .7 + .3 * Math.random()); streams[i].material.opacity = .35 + .2 * Math.random();
          sparks.emit(dep3, Math.random() < .7 ? 1 : 0, u3.set(0, .25, 0), .7, .25);
          if (i === 0) { arc.position.copy(dep3); arc.color.setHex(0xff9a50); arc.intensity = 1.6 + Math.random() * .8; }
        } else { laser.visible = false; core.visible = false; streams[i].visible = false; }
        if (spraying) {                                                         // the spray: a mist cone from the nozzle onto the shell
          A.tip.getWorldPosition(w3); u3.set(0, U.uPaintY.value, 0); const hit = u3.clone().addScaledVector(w3.clone().sub(u3).normalize(), .5);
          place(sprayCones[i], w3, hit, 1); sprayCones[i].material.opacity = .1 + .06 * Math.random();
          dir3.subVectors(hit, w3).normalize().multiplyScalar(2.4); mist.emit(w3, LITE ? 3 : 7, dir3, .9, .3);
        } else sprayCones[i].visible = false;
      });
      sparks.step(dt); mist.step(dt);
      R.render(scene, cam);
      return R.domElement;
    },
  });
} catch (e) { console.warn('[build bay] off:', e && e.message); }

window.Mesh3D = { end, bh, build };
