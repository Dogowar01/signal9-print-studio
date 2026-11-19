// "On the wall": a shadowed figure walks in carrying the chosen work, hangs it, steps back, and
// the light comes up on it. Two rooms: a photographed living room (the figure and the work are
// 3D, composited into the photo) and a dim gallery built entirely in 3D. Drawn with three.js,
// which is only loaded the first time the scene opens. With reduced motion it opens on the final frame.

import { reducedMotion } from './motion.js';
import { prefs } from './util.js';

let threeLoading = null;
const loadThree = () => (threeLoading ??= import('/vendor/three.module.js').catch((err) => {
  threeLoading = null;
  throw err;
}));

let current = null;
export const hangOpen = () => Boolean(current);
export const closeHang = () => current?.close();

const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const ic = {
  close: svg('M6 6l12 12M18 6 6 18'),
  replay: svg('M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5'),
};

// ---------- Timing helpers ----------

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, k) => a + (b - a) * k;
const span = (t, a, d) => clamp01((t - a) / d);
const smooth = (x) => (x = clamp01(x), x * x * (3 - 2 * x));
const inOut = (x) => (x = clamp01(x), x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const angleTo = (from, to) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from));

// Distance along a walk that speeds up, cruises, then slows (trapezoid velocity), and its speed.
function cruise(t, length, duration, ramp) {
  const v = length / (duration - ramp);
  if (t <= 0) return { s: 0, v: 0 };
  if (t >= duration) return { s: length, v: 0 };
  if (t < ramp) return { s: (v * t * t) / (2 * ramp), v: (v * t) / ramp };
  if (t > duration - ramp) {
    const r = duration - t;
    return { s: length - (v * r * r) / (2 * ramp), v: (v * r) / ramp };
  }
  return { s: v * (ramp / 2 + t - ramp), v };
}

// ---------- The gallery room ----------

const ROOM = { w: 9, d: 7.5, h: 3.2, wall: 0.2, door0: 2.05, door1: 3.45, doorH: 2.3 };
const LEFT = -ROOM.w / 2;
const HANG = { x: 0.35, y: 1.62 }; // where the work's centre ends up on the back wall
const STAND = { x: HANG.x, z: 0.52 }; // where the figure stands to hang it
const ADMIRE = { x: HANG.x - 1.55, z: 1.85 }; // where it steps back to
const WALK = [[-6.3, 0.2], [-6.0, 1.6], [-4.9, 2.6], [-3.3, 2.55], [-1.3, 1.75], [HANG.x - 0.1, 1.0], [STAND.x, STAND.z]];
const SPEED = 1.15; // metres a second
const STRIDE = 0.27; // each foot's reach ahead of and behind the hip

function canvasTexture(T, w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new T.CanvasTexture(c);
  tex.wrapS = tex.wrapT = T.RepeatWrapping;
  tex.repeat.set(...repeat);
  tex.colorSpace = T.SRGBColorSpace;
  return tex;
}

// Old plaster: a warm wash with soft blotches and fine grit.
const plaster = (T) => canvasTexture(T, 512, 512, (g, w, h) => {
  g.fillStyle = '#b8ad9c';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) {
    const r = 30 + Math.random() * 110;
    const x = Math.random() * w;
    const y = Math.random() * h;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const dark = Math.random() < 0.5;
    grad.addColorStop(0, dark ? 'rgba(70,58,45,.07)' : 'rgba(255,248,235,.06)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(40,32,24,.08)' : 'rgba(255,250,240,.07)';
    g.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
}, [3, 1.2]);

// Dark oiled floorboards running across the room.
const boards = (T) => canvasTexture(T, 1024, 1024, (g, w, h) => {
  const rows = 10;
  const bh = h / rows;
  for (let r = 0; r < rows; r++) {
    let x = -Math.random() * 400;
    while (x < w) {
      const len = 260 + Math.random() * 380;
      const l = 15 + Math.random() * 7;
      g.fillStyle = `hsl(${22 + Math.random() * 8}, ${32 + Math.random() * 10}%, ${l}%)`;
      g.fillRect(x, r * bh, len, bh);
      for (let k = 0; k < 14; k++) {
        g.strokeStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,220,180'},${0.04 + Math.random() * 0.05})`;
        g.lineWidth = 1 + Math.random() * 2;
        const y = r * bh + Math.random() * bh;
        g.beginPath();
        g.moveTo(x, y);
        g.bezierCurveTo(x + len / 3, y + (Math.random() - 0.5) * 8, x + (len * 2) / 3, y + (Math.random() - 0.5) * 8, x + len, y);
        g.stroke();
      }
      g.fillStyle = 'rgba(0,0,0,.55)';
      g.fillRect(x, r * bh, 2, bh);
      x += len;
    }
    g.fillStyle = 'rgba(0,0,0,.6)';
    g.fillRect(0, r * bh, w, 2);
  }
}, [2.2, 2.2]);

// A soft round dot for dust in the light.
const mote = (T) => canvasTexture(T, 64, 64, (g) => {
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
});

// A faint cone of light in the air, brightest at the lamp.
function beamMaterial(T, color) {
  return new T.ShaderMaterial({
    uniforms: { color: { value: new T.Color(color) }, strength: { value: 0 } },
    vertexShader: `
      varying float vAlong; varying vec3 vN; varying vec3 vView;
      void main() {
        vAlong = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 color; uniform float strength;
      varying float vAlong; varying vec3 vN; varying vec3 vView;
      void main() {
        float edge = pow(abs(dot(normalize(vN), normalize(vView))), 2.0);
        float fade = pow(vAlong, 1.6);
        gl_FragColor = vec4(color * strength * edge * fade, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    side: T.DoubleSide,
  });
}

function box(T, mat, w, h, d, x, y, z, { cast = true, receive = true } = {}) {
  const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

function buildRoom(T, scene) {
  const { w, d, h, wall, door0, door1, doorH } = ROOM;
  const wallTex = plaster(T);
  const wallMat = new T.MeshStandardMaterial({ color: 0xffffff, map: wallTex, roughness: 0.95 });
  const sideTex = wallTex.clone();
  sideTex.repeat.set(2.4, 1.2);
  const sideMat = new T.MeshStandardMaterial({ color: 0xf2ece4, map: sideTex, roughness: 0.95 });
  const floorMat = new T.MeshStandardMaterial({ map: boards(T), roughness: 0.55, metalness: 0.02 });
  const trim = new T.MeshStandardMaterial({ color: 0x1a1613, roughness: 0.6 });
  const ceiling = new T.MeshStandardMaterial({ color: 0x2a2622, roughness: 1 });

  const floor = new T.Mesh(new T.PlaneGeometry(w + 6, d + 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(-3, 0, d / 2);
  floor.receiveShadow = true;
  scene.add(floor);

  // Back wall, side walls with a doorway on the left, ceiling.
  scene.add(box(T, wallMat, w + wall * 2, h, wall, 0, h / 2, -wall / 2));
  const lx = LEFT - wall / 2;
  scene.add(box(T, sideMat, wall, h, door0 + wall, lx, h / 2, (door0 - wall) / 2));
  scene.add(box(T, sideMat, wall, h, d - door1, lx, h / 2, (door1 + d) / 2));
  scene.add(box(T, sideMat, wall, h - doorH, door1 - door0, lx, (h + doorH) / 2, (door0 + door1) / 2));
  scene.add(box(T, sideMat, wall, h, d + wall, w / 2 + wall / 2, h / 2, (d - wall) / 2));
  scene.add(box(T, ceiling, w + wall * 2, 0.1, d + wall, 0, h + 0.05, (d - wall) / 2, { cast: true, receive: false }));

  // Skirting and the door's architrave.
  scene.add(box(T, trim, w, 0.11, 0.025, 0, 0.055, 0.012));
  scene.add(box(T, trim, 0.025, 0.11, door0, LEFT + 0.012, 0.055, door0 / 2));
  scene.add(box(T, trim, 0.025, 0.11, d - door1, LEFT + 0.012, 0.055, (door1 + d) / 2));
  scene.add(box(T, trim, 0.04, doorH + 0.08, 0.08, LEFT + 0.02, (doorH + 0.08) / 2, door0 - 0.04));
  scene.add(box(T, trim, 0.04, doorH + 0.08, 0.08, LEFT + 0.02, (doorH + 0.08) / 2, door1 + 0.04));
  scene.add(box(T, trim, 0.04, 0.08, door1 - door0 + 0.16, LEFT + 0.02, doorH + 0.04, (door0 + door1) / 2));

  // The lit corridor beyond the door, glowing on its own so it never leaks light through walls.
  const glow = new T.MeshStandardMaterial({ color: 0x000000, emissive: 0xd9a46a, emissiveIntensity: 0, roughness: 1 });
  const corridorWall = new T.Mesh(new T.PlaneGeometry(9, h), glow);
  corridorWall.rotation.y = Math.PI / 2;
  corridorWall.position.set(LEFT - 3.3, h / 2, 2.5);
  scene.add(corridorWall);

  // The ceiling lamp over the hanging spot.
  const lampMat = new T.MeshStandardMaterial({ color: 0x0f0d0c, roughness: 0.4, metalness: 0.6 });
  const lensMat = new T.MeshStandardMaterial({ color: 0x000000, emissive: 0xfff1dc, emissiveIntensity: 0 });
  const lamp = new T.Group();
  const can = new T.Mesh(new T.CylinderGeometry(0.07, 0.085, 0.22, 24), lampMat);
  const lens = new T.Mesh(new T.CircleGeometry(0.07, 24), lensMat);
  lens.rotation.x = Math.PI / 2;
  lens.position.y = -0.111;
  lamp.add(can, lens);
  const rail = box(T, lampMat, 0.05, 0.03, 3.4, HANG.x, h - 0.015, 2.0, { cast: false });
  scene.add(rail);
  return { glow, lamp, lensMat, lampMat };
}

// ---------- The figure: a shaped silhouette, posed each frame by two-bone IK ----------

// A round-ended body part whose radius follows `profile` ([[t, r], …], t from 0 at the joint it
// starts from to 1 at the one it ends at). Centred, so place() can stretch it between two joints.
function limbGeometry(T, len, profile, grow = 0) {
  const r0 = profile[0][1] + grow;
  const r1 = profile[profile.length - 1][1] + grow;
  const pts = [];
  for (let i = 0; i <= 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2);
    pts.push(new T.Vector2(Math.max(0, Math.cos(a) * r0), Math.sin(a) * r0));
  }
  for (const [t, r] of profile.slice(1, -1)) pts.push(new T.Vector2(r + grow, t * len));
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    pts.push(new T.Vector2(Math.max(0, Math.cos(a) * r1), len + Math.sin(a) * r1));
  }
  const g = new T.LatheGeometry(pts, 22);
  g.translate(0, -len / 2, 0);
  return g;
}

function buildFigure(T, scene) {
  // The figure is see-through as one layer, like a shadow: first every part writes only its depth,
  // then the body is tinted in once where it's nearest the camera, so overlapping limbs don't show
  // through each other or stack up darker. Everything behind it, including its own shadow on the
  // wall (drawn earlier, at render order 0), shows through. Its shadow stays solid: three.js casts
  // shadows from shape, not opacity, and only the body (not the depth or outline layers) casts.
  const OPACITY = 0.88;
  const depthOnly = new T.MeshBasicMaterial({ colorWrite: false, transparent: true });
  const skin = new T.MeshStandardMaterial({ color: 0x060505, roughness: 1, transparent: true, opacity: OPACITY, depthWrite: false });
  // A thin warm edge around the silhouette (an inverted hull, drawn from its back faces).
  const edge = new T.MeshBasicMaterial({ color: 0xb5623a, side: T.BackSide, transparent: true, opacity: 0.75 * OPACITY, depthWrite: false });
  const OUT = 0.008;
  const up = new T.Vector3(0, 1, 0);

  // A shape and its outline, scaled across (sx), along (sy) and through (sz) its length.
  const shell = (geo, hullGeo, sx = 1, sy = 1, sz = 1) => {
    const g = new T.Group();
    const d = new T.Mesh(geo, depthOnly);
    d.renderOrder = 2;
    const m = new T.Mesh(geo, skin);
    m.renderOrder = 3;
    m.castShadow = true;
    const h = new T.Mesh(hullGeo, edge);
    h.renderOrder = 4;
    for (const x of [d, m, h]) x.scale.set(sx, sy, sz);
    g.add(d, m, h);
    return g;
  };
  const limb = (len, profile, sx = 1, sz = 1) => {
    const g = shell(limbGeometry(T, len, profile), limbGeometry(T, len, profile, OUT), sx, 1, sz);
    scene.add(g);
    return g;
  };
  const blob = (r, sx = 1, sy = 1, sz = 1) => shell(new T.SphereGeometry(r, 24, 16), new T.SphereGeometry(r + OUT, 24, 16), sx, sy, sz);
  const pair = (make) => [make(), make()];

  // Proportions of someone about 1.75 m tall.
  const P = {
    torso: limb(0.5, [[0, 0.13], [0.2, 0.121], [0.45, 0.137], [0.7, 0.156], [0.86, 0.158], [0.95, 0.135], [1, 0.07]], 1.22, 0.72),
    pelvis: blob(0.1, 1.62, 1, 1.18),
    neck: limb(0.09, [[0, 0.05], [1, 0.042]]),
    head: new T.Group(),
    deltoid: pair(() => blob(0.05, 1, 1.15, 1.05)),
    upperArm: pair(() => limb(0.29, [[0, 0.05], [0.3, 0.052], [1, 0.039]], 1, 0.9)),
    foreArm: pair(() => limb(0.26, [[0, 0.04], [0.3, 0.043], [1, 0.028]], 1, 0.85)),
    hand: pair(() => limb(0.075, [[0, 0.026], [0.6, 0.031], [1, 0.019]], 0.6, 1)),
    thigh: pair(() => limb(0.44, [[0, 0.084], [0.4, 0.075], [1, 0.053]], 1, 1.05)),
    shin: pair(() => limb(0.45, [[0, 0.051], [0.25, 0.058], [0.7, 0.04], [1, 0.033]], 0.95, 1)),
    foot: pair(() => limb(0.17, [[0, 0.04], [0.45, 0.047], [1, 0.036]], 1.05, 0.62)),
  };
  scene.add(P.pelvis, ...P.deltoid);
  // Head: cranium, the back of the head, jaw and nose, so it reads as a head in profile.
  const cranium = blob(0.097, 0.92, 1.06, 1.02);
  const occiput = blob(0.094, 0.95, 0.98, 1);
  occiput.position.set(0, 0.012, -0.018);
  const jaw = blob(0.066, 0.9, 0.85, 1);
  jaw.position.set(0, -0.058, 0.028);
  const nose = blob(0.017, 0.9, 1.3, 1);
  nose.position.set(0, -0.012, 0.093);
  P.head.add(cranium, occiput, jaw, nose);
  scene.add(P.head);

  const v = () => new T.Vector3();
  const tmp = { d: v(), n: v(), bx: v(), by: v(), bz: v(), m: new T.Matrix4() };
  // Turns g so its length runs along yDir and its width along xHint.
  const orient = (g, xHint, yDir) => {
    tmp.by.copy(yDir).normalize();
    tmp.bx.copy(xHint).addScaledVector(tmp.by, -xHint.dot(tmp.by)).normalize();
    tmp.bz.crossVectors(tmp.bx, tmp.by);
    tmp.m.makeBasis(tmp.bx, tmp.by, tmp.bz);
    g.quaternion.setFromRotationMatrix(tmp.m);
  };
  const place = (g, a, b, xHint) => {
    g.position.addVectors(a, b).multiplyScalar(0.5);
    orient(g, xHint, tmp.n.subVectors(b, a));
  };
  // Elbow or knee for a limb from S reaching for Tg, bending towards pole. Also gives the reached end.
  const ik = (S, Tg, a, b, pole, outE, outEnd) => {
    tmp.d.subVectors(Tg, S);
    const len = Math.min(a + b - 1e-4, Math.max(Math.abs(a - b) + 1e-3, tmp.d.length()));
    tmp.d.normalize();
    const cosA = (a * a + len * len - b * b) / (2 * a * len);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    tmp.n.copy(pole).addScaledVector(tmp.d, -pole.dot(tmp.d)).normalize();
    outE.copy(S).addScaledVector(tmp.d, a * cosA).addScaledVector(tmp.n, a * sinA);
    outEnd.copy(S).addScaledVector(tmp.d, len);
  };

  const J = {
    pelvis: v(), neck: v(), head: v(), fwd: v(), side: v(), spine: v(), shoulderSide: v(), hipSide: v(), pole: v(),
    hip: [v(), v()], knee: [v(), v()], ankle: [v(), v()], shoulder: [v(), v()], elbow: [v(), v()], wrist: [v(), v()],
    target: [v(), v()], rest: v(), a: v(), b: v(), dir: v(), upright: v(),
  };

  // One foot's place in the stride. u: 0..0.5 planted (heel strike, roll, heel lifting), 0.5..1 swinging.
  function step(u) {
    if (u < 0.5) {
      const roll = smooth((u - 0.3) / 0.2);
      return { off: STRIDE * (1 - 4 * u), lift: 0.05 * roll, pitch: u < 0.08 ? lerp(-0.25, 0, u / 0.08) : 0.5 * roll };
    }
    const k = (u - 0.5) * 2;
    return {
      off: -STRIDE + 2 * STRIDE * (0.5 - 0.5 * Math.cos(Math.PI * k)),
      lift: 0.09 * Math.sin(Math.PI * k) + 0.05 * (1 - smooth(k * 2)),
      pitch: lerp(0.5, -0.25, smooth(k)),
    };
  }

  // pose: x, z, yaw, cycle (gait position, in strides), amp (0..1), move (unit world direction of travel),
  // lean, look (head pitch), hands: [left, right] world targets, hold: [left, right] 0..1 blend from swinging to holding.
  function update(pose) {
    const { fwd, side } = J;
    const amp = pose.amp;
    fwd.set(Math.sin(pose.yaw), 0, Math.cos(pose.yaw));
    side.crossVectors(fwd, up); // the figure's right
    const feet = [0, 0.5].map((phase) => {
      const s = step((((pose.cycle + phase) % 1) + 1) % 1);
      return { off: s.off * amp, lift: s.lift * amp, pitch: s.pitch * amp };
    });

    // The hips sway over the planted foot and turn with the forward leg; the shoulders turn against them.
    const u0 = (((pose.cycle % 1) + 1) % 1);
    const reach = (feet[1].off - feet[0].off) / (2 * STRIDE);
    J.shoulderSide.copy(side).applyAxisAngle(up, -0.13 * reach);
    J.hipSide.copy(side).applyAxisAngle(up, 0.09 * reach);
    const dip = 0.03 * amp * Math.abs(feet[0].off / STRIDE);
    J.pelvis.set(pose.x, 0.96 - dip, pose.z).addScaledVector(side, -0.022 * amp * Math.sin(Math.PI * 2 * u0));
    J.spine.copy(up).multiplyScalar(Math.cos(pose.lean)).addScaledVector(fwd, Math.sin(pose.lean));
    J.neck.copy(J.pelvis).addScaledVector(J.spine, 0.52);
    J.head.copy(J.neck).addScaledVector(up, 0.155).addScaledVector(fwd, 0.028 - pose.look * 0.03);

    place(P.torso, J.a.copy(J.pelvis).addScaledVector(J.spine, -0.02), J.neck, J.shoulderSide);
    P.pelvis.position.copy(J.pelvis).addScaledVector(up, -0.045);
    orient(P.pelvis, J.hipSide, J.spine);
    place(P.neck, J.a.copy(J.neck).addScaledVector(J.spine, -0.03), J.b.copy(J.head).addScaledVector(up, -0.05), side);
    P.head.position.copy(J.head);
    P.head.rotation.set(-pose.look * 0.5, pose.yaw, 0, 'YXZ');

    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const foot = feet[i];
      // Legs: hip to a planted or swinging ankle, knees bending forward.
      J.hip[i].copy(J.pelvis).addScaledVector(up, -0.05).addScaledVector(J.hipSide, s * 0.095);
      J.a.set(J.hip[i].x, 0.085 + foot.lift, J.hip[i].z).addScaledVector(pose.move, foot.off);
      J.pole.copy(fwd).addScaledVector(up, 0.1);
      ik(J.hip[i], J.a, 0.44, 0.45, J.pole, J.knee[i], J.ankle[i]);
      place(P.thigh[i], J.hip[i], J.knee[i], side);
      place(P.shin[i], J.knee[i], J.ankle[i], side);
      // The foot rolls from heel to toe: toes up as the heel strikes, heel up as it pushes off.
      J.dir.copy(fwd).multiplyScalar(Math.cos(foot.pitch)).addScaledVector(up, -Math.sin(foot.pitch));
      J.upright.copy(up).multiplyScalar(Math.cos(foot.pitch)).addScaledVector(fwd, Math.sin(foot.pitch));
      J.a.copy(J.ankle[i]).addScaledVector(J.dir, -0.045).addScaledVector(J.upright, -0.05);
      J.b.copy(J.a).addScaledVector(J.dir, 0.2);
      place(P.foot[i], J.a, J.b, side);

      // Arms: hanging with a soft elbow and swinging against the legs, or reaching for the picture.
      J.shoulder[i].copy(J.pelvis).addScaledVector(J.spine, 0.44).addScaledVector(J.shoulderSide, s * 0.175);
      P.deltoid[i].position.copy(J.shoulder[i]).addScaledVector(J.shoulderSide, s * -0.006).addScaledVector(up, -0.018);
      P.deltoid[i].quaternion.copy(P.torso.quaternion);
      J.rest.copy(J.shoulder[i]).addScaledVector(up, -0.5).addScaledVector(side, s * 0.05)
        .addScaledVector(fwd, 0.04).addScaledVector(pose.move, -0.55 * foot.off);
      J.target[i].copy(J.rest).lerp(pose.hands[i], pose.hold[i]);
      J.pole.copy(fwd).multiplyScalar(-1).addScaledVector(side, s * 0.35).addScaledVector(up, -0.15);
      ik(J.shoulder[i], J.target[i], 0.29, 0.26, J.pole, J.elbow[i], J.wrist[i]);
      place(P.upperArm[i], J.shoulder[i], J.elbow[i], side);
      place(P.foreArm[i], J.elbow[i], J.wrist[i], side);
      // The hand carries on from the forearm, dropping a little when it hangs loose.
      J.dir.subVectors(J.wrist[i], J.elbow[i]).normalize().addScaledVector(up, -0.35 * (1 - pose.hold[i])).normalize();
      place(P.hand[i], J.wrist[i], J.b.copy(J.wrist[i]).addScaledVector(J.dir, 0.075), side);
    }
  }
  return { update };
}

// ---------- The framed work ----------

function buildPicture(T, scene, texture, aspect, outer = 0.95) {
  const rim = 0.045;
  const matW = 0.075;
  const depth = 0.04;
  const inner = outer - 2 * (rim + matW);
  const aw = aspect >= 1 ? inner : inner * aspect;
  const ah = aspect >= 1 ? inner / aspect : inner;
  const ow = aw + 2 * (rim + matW);
  const oh = ah + 2 * (rim + matW);
  const g = new T.Group();
  const frame = new T.MeshStandardMaterial({ color: 0x14110f, roughness: 0.42, metalness: 0.15 });
  const add = (mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  add(box(T, frame, ow, rim, depth, 0, oh / 2 - rim / 2, 0));
  add(box(T, frame, ow, rim, depth, 0, -oh / 2 + rim / 2, 0));
  add(box(T, frame, rim, oh - rim * 2, depth, -ow / 2 + rim / 2, 0, 0));
  add(box(T, frame, rim, oh - rim * 2, depth, ow / 2 - rim / 2, 0, 0));
  add(box(T, new T.MeshStandardMaterial({ color: 0x6e5236, roughness: 1 }), ow - 0.01, oh - 0.01, 0.006, 0, 0, -depth / 2 + 0.003));
  const mat = add(new T.Mesh(new T.PlaneGeometry(ow - rim * 2, oh - rim * 2), new T.MeshStandardMaterial({ color: 0xe9e1cf, roughness: 0.95 })));
  mat.position.z = depth / 2 - 0.014;
  const art = add(new T.Mesh(new T.PlaneGeometry(aw, ah), new T.MeshStandardMaterial({
    color: texture ? 0xffffff : 0x8a847c, map: texture || null, roughness: 0.75,
  })));
  art.position.z = depth / 2 - 0.013;
  scene.add(g);
  return { group: g, ow, oh, depth };
}

// ---------- The gallery: lights, lamp beam, dust and camera ----------

const shadowed = (light, size, radius = 4) => {
  light.castShadow = true;
  light.shadow.mapSize.set(size, size);
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.02;
  light.shadow.camera.near = 0.3;
  light.shadow.camera.far = 16;
  light.shadow.radius = radius;
  return light;
};

function gallerySet(T, scene, renderer, camera) {
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  scene.background = new T.Color(0x050404);
  scene.fog = new T.Fog(0x050404, 9, 18);
  const room = buildRoom(T, scene);

  // A dim room, warm light spilling through the door behind the figure, and the gallery lamp
  // that comes up once the work is on the wall.
  const hemi = new T.HemisphereLight(0xcfc3b4, 0x2a2018, 0.4);
  const moon = new T.DirectionalLight(0x7fa6bf, 0.28);
  moon.position.set(4, 3, 8);
  scene.add(hemi, moon);

  const door = shadowed(new T.SpotLight(0xffc68a, 0, 0, 0.62, 0.55, 1.4), 2048);
  door.position.set(LEFT - 2.9, 2.75, 2.75);
  door.target.position.set(-1.2, 0, 2.2);
  scene.add(door, door.target);

  const lampPos = new T.Vector3(HANG.x, ROOM.h - 0.14, 2.0);
  const lampAim = new T.Vector3(HANG.x, HANG.y - 0.05, 0);
  const gallery = shadowed(new T.SpotLight(0xfff0d8, 0, 0, 0.34, 0.85, 1.3), 2048);
  gallery.position.copy(lampPos);
  gallery.target.position.copy(lampAim);
  scene.add(gallery, gallery.target);
  room.lamp.position.copy(lampPos).add(new T.Vector3(0, 0.03, 0));
  room.lamp.lookAt(lampAim);
  room.lamp.rotateX(-Math.PI / 2);
  scene.add(room.lamp);

  // The lamp's beam in the air, with dust drifting through it.
  const beamLen = lampPos.distanceTo(lampAim) + 0.25;
  const beamMat = beamMaterial(T, 0xffe6c4);
  const beam = new T.Mesh(new T.CylinderGeometry(0.06, Math.tan(0.36) * beamLen * 0.9, beamLen, 48, 1, true), beamMat);
  beam.position.copy(lampPos).lerp(lampAim, 0.5 * (beamLen / lampPos.distanceTo(lampAim)));
  beam.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), lampPos.clone().sub(lampAim).normalize());
  beam.renderOrder = 5; // after the see-through figure, so light in front of it stays visible
  scene.add(beam);

  const DUST = 260;
  const dustSeed = Array.from({ length: DUST }, () => [Math.random(), Math.random(), Math.random(), Math.random()]);
  const dustPos = new Float32Array(DUST * 3);
  const dustGeo = new T.BufferGeometry();
  dustGeo.setAttribute('position', new T.BufferAttribute(dustPos, 3));
  const dustMat = new T.PointsMaterial({
    size: 0.014, map: mote(T), color: 0xffe2b8, transparent: true, opacity: 0,
    depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: true,
  });
  const dust = new T.Points(dustGeo, dustMat);
  dust.renderOrder = 5;
  scene.add(dust);
  const axis = lampAim.clone().sub(lampPos).normalize();
  const ortho1 = new T.Vector3(1, 0, 0);
  const ortho2 = new T.Vector3().crossVectors(axis, ortho1).normalize();
  function drift(clock) {
    for (let i = 0; i < DUST; i++) {
      const [a, b, c, d] = dustSeed[i];
      const along = ((a + clock * 0.012 * (0.5 + d)) % 1) * beamLen * 0.95;
      const r = Math.sqrt(b) * Math.tan(0.34) * along;
      const th = c * Math.PI * 2 + clock * 0.05 * (d - 0.5);
      dustPos[i * 3] = lampPos.x + axis.x * along + (ortho1.x * Math.cos(th) + ortho2.x * Math.sin(th)) * r;
      dustPos[i * 3 + 1] = lampPos.y + axis.y * along + (ortho1.y * Math.cos(th) + ortho2.y * Math.sin(th)) * r + Math.sin(clock * 0.3 + i) * 0.01;
      dustPos[i * 3 + 2] = lampPos.z + axis.z * along + (ortho1.z * Math.cos(th) + ortho2.z * Math.sin(th)) * r;
    }
    dustGeo.attributes.position.needsUpdate = true;
  }

  const camA = { pos: new T.Vector3(2.75, 1.6, 7.1), look: new T.Vector3(-1.5, 1.2, 1.4) };
  const camB = { pos: new T.Vector3(2.2, 1.6, 5.3), look: new T.Vector3(-0.3, 1.32, 0.6) };
  const look = new T.Vector3();
  const parallax = { x: 0, y: 0, tx: 0, ty: 0 };

  return {
    walk: WALK, hang: HANG, stand: STAND, admire: ADMIRE, outer: 1.08,
    // The doorway glows up first; the gallery lamp warms (with a flicker) once the work is up.
    light(t, ph, clock) {
      const doorUp = smooth(span(t, 0, 1.6));
      const lampUp = smooth(span(t, ph.tLight, 2.6));
      const flicker = t > ph.tLight && t < ph.tLight + 0.5 ? (Math.sin((t - ph.tLight) * 60) > 0.2 ? 0.5 : 1) : 1;
      const lamp = lampUp * flicker;
      door.intensity = 80 * doorUp * (1 - 0.45 * lampUp);
      room.glow.emissiveIntensity = 0.3 * doorUp * (1 - 0.35 * lampUp);
      gallery.intensity = 34 * lamp;
      room.lensMat.emissiveIntensity = 3 * lamp;
      beamMat.uniforms.strength.value = 0.22 * lamp;
      dustMat.opacity = 0.85 * lamp;
      hemi.intensity = 0.4 + 0.15 * lampUp;
      renderer.toneMappingExposure = 1.1 * smooth(span(t, 0, 1.1));
      drift(clock);
    },
    // Follows the walk a little, then drifts in towards the hung work.
    cam(t, ph, pose) {
      const ck = inOut(span(t, ph.tCam, ph.camDur));
      const follow = 0.28 * (1 - ck);
      look.copy(camA.look).lerp(camB.look, ck);
      look.x += (pose.x - camA.look.x) * follow * (t < ph.tBack ? 1 : 0.4);
      camera.position.lerpVectors(camA.pos, camB.pos, ck);
      parallax.x += (parallax.tx - parallax.x) * 0.04;
      parallax.y += (parallax.ty - parallax.y) * 0.04;
      camera.position.x += parallax.x * 0.25;
      camera.position.y += parallax.y * 0.12;
      camera.lookAt(look);
    },
    resize(w, h) {
      camera.aspect = w / h;
      // Keep the room's width in frame on narrow windows.
      camera.fov = camera.aspect < 1.5 ? Math.min(62, 40 * (1.5 / camera.aspect) ** 0.75) : 40;
      camera.updateProjectionMatrix();
    },
    point(nx, ny) {
      parallax.tx = nx;
      parallax.ty = ny;
    },
  };
}

// ---------- A photographed room ----------

// The photo is the backdrop, seen straight on from where it was taken, so its wall is the plane
// z = 0. The figure and the work are real 3D in front of it; their shadows fall on the photographed
// wall, and whatever in the photo stands nearer the camera than the figure is drawn back over it.
const LIVING = {
  src: '/img/rooms/living-room.webp',
  size: [1536, 1024],
  scale: 450, // photo pixels per metre, on the wall
  eye: 1.1, // camera height in metres, level with the photo's middle row
  dist: 7, // camera distance from the wall (long lens: sizes change gently with depth, as in the photo)
  wall: [160, 1310], // the bare wall runs between the window and the shelves (photo x)
  // The figure crosses in front of the sofa, behind the coffee table, to the bare wall.
  walk: [[-2.5, 1.35], [-1.3, 1.3], [-0.5, 1.12], [-0.06, 0.8], [0.07, 0.47]],
  hang: { x: 0.07, y: 1.5 },
  stand: { x: 0.07, z: 0.47 },
  admire: { x: -1.15, z: 1.2 },
  outer: 0.98,
  sun: [-1.2, 0.6, 2.0], // towards the window light, from the wall
  // The coffee table with its books, mug, bowl and plant, traced in photo pixels.
  foreground: [[
    591, 1030, 591, 1000, 620, 986, 665, 976, 709, 969, 709, 945, 746, 944, 740, 930, 719, 911, 713, 885, 721, 867,
    746, 863, 758, 858, 830, 859, 836, 870, 835, 915, 860, 915, 910, 914, 955, 915, 960, 890, 954, 864, 940, 882,
    910, 886, 891, 872, 880, 891, 866, 879, 863, 840, 874, 828, 865, 805, 865, 782, 885, 765, 920, 755, 944, 758,
    956, 771, 985, 761, 1010, 736, 1032, 726, 1060, 726, 1079, 741, 1101, 741, 1121, 749, 1136, 769, 1135, 786,
    1155, 792, 1168, 790, 1186, 802, 1189, 823, 1211, 825, 1227, 840, 1224, 864, 1208, 851, 1191, 853, 1178, 846,
    1164, 855, 1163, 882, 1148, 896, 1130, 890, 1131, 915, 1136, 939, 1176, 941, 1211, 964, 1225, 969, 1260, 968,
    1310, 974, 1339, 986, 1340, 1030,
  ]],
};

// Sunlight broken up by leaves outside, for the light that falls on the hung work.
const leafLight = (T) => canvasTexture(T, 512, 512, (g, w, h) => {
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.filter = 'blur(10px)';
  for (let i = 0; i < 46; i++) {
    const x = 40 + Math.random() * (w - 80);
    const y = 40 + Math.random() * (h - 80);
    g.save();
    g.translate(x, y);
    g.rotate(-0.6 + Math.random() * 0.3);
    g.fillStyle = `rgba(255,255,255,${0.45 + Math.random() * 0.5})`;
    g.beginPath();
    g.ellipse(0, 0, 14 + Math.random() * 40, 8 + Math.random() * 18, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
});

function photoSet(T, scene, renderer, camera, photo, R) {
  renderer.toneMapping = T.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.type = T.PCFShadowMap;
  scene.background = new T.Color(0x0d0b0a);
  photo.colorSpace = T.SRGBColorSpace;
  const [pw, ph] = R.size;
  const W = pw / R.scale;
  const H = ph / R.scale;
  const wx = (x) => (x - pw / 2) / R.scale;

  const plane = new T.PlaneGeometry(W, H);
  const back = new T.Mesh(plane, new T.MeshBasicMaterial({ map: photo, toneMapped: false }));
  back.position.set(0, R.eye, 0);
  scene.add(back);

  // Catches the shadows of the figure and the frame on the photographed wall.
  const [x0, x1] = R.wall.map(wx);
  const catcher = new T.Mesh(new T.PlaneGeometry(x1 - x0, H), new T.ShadowMaterial({ color: 0x2b1c10, opacity: 0.4, depthWrite: false }));
  catcher.position.set((x0 + x1) / 2, R.eye, 0.002);
  catcher.receiveShadow = true;
  scene.add(catcher);

  // The photo again, cut down to its foreground and drawn over everything.
  const c = document.createElement('canvas');
  c.width = pw;
  c.height = ph;
  const g = c.getContext('2d');
  g.filter = 'blur(1.2px)';
  g.fillStyle = '#fff';
  for (const poly of R.foreground) {
    g.beginPath();
    for (let i = 0; i < poly.length; i += 2) g.lineTo(poly[i], poly[i + 1]);
    g.closePath();
    g.fill();
  }
  const mask = new T.CanvasTexture(c);
  const front = new T.Mesh(plane, new T.MeshBasicMaterial({
    map: photo, alphaMap: mask, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  }));
  front.position.copy(back.position);
  front.renderOrder = 10;
  scene.add(front);

  // Light to match the photo: warm room light, and low sun from the window on the left.
  const toSun = new T.Vector3(...R.sun).normalize();
  const hemi = new T.HemisphereLight(0xfff2e3, 0x7a634e, 1.5);
  const sun = new T.DirectionalLight(0xffe3c0, 1.9);
  sun.target.position.set(0, R.eye, 0.6);
  sun.position.copy(sun.target.position).addScaledVector(toSun, 8);
  shadowed(sun, 2048, 5);
  Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 16 });
  scene.add(hemi, sun, sun.target);

  // Once the work is up, sun through the leaves comes across it and sways a little.
  const hangAt = new T.Vector3(R.hang.x, R.hang.y, 0);
  const dapple = new T.SpotLight(0xffe7c2, 0, 0, 0.12, 0.45, 0);
  dapple.map = leafLight(T);
  shadowed(dapple, 1024, 3);
  dapple.shadow.camera.far = 12;
  const dappleAt = hangAt.clone().addScaledVector(toSun, 6);
  dapple.target.position.copy(hangAt);
  scene.add(dapple, dapple.target);

  camera.position.set(0, R.eye, R.dist);
  camera.lookAt(0, R.eye, 0);
  let size = { w: 1, h: 1 };

  return {
    walk: R.walk, hang: R.hang, stand: R.stand, admire: R.admire, outer: R.outer,
    light(t, ph, clock) {
      dapple.intensity = 2.6 * smooth(span(t, ph.tLight, 3));
      dapple.position.copy(dappleAt);
      dapple.position.x += Math.sin(clock * 0.7) * 0.05;
      dapple.position.y += Math.sin(clock * 0.45 + 1) * 0.03;
    },
    // A slow push in on the work: a crop of the same view, so the photo and the 3D stay matched.
    cam(t, ph) {
      const k = inOut(span(t, ph.tCam, ph.camDur));
      if (k <= 0) {
        if (camera.view?.enabled) camera.clearViewOffset();
        return;
      }
      const z = 1 + 0.12 * k;
      const vw = size.w / z;
      const vh = size.h / z;
      const cx = lerp(0.5, 0.41, k) * size.w;
      const cy = lerp(0.5, 0.44, k) * size.h;
      camera.setViewOffset(size.w, size.h,
        Math.min(size.w - vw, Math.max(0, cx - vw / 2)), Math.min(size.h - vh, Math.max(0, cy - vh / 2)), vw, vh);
    },
    // Show the whole photo's height or width, whichever fills the window, like background-size: cover.
    resize(w, h) {
      size = { w, h };
      camera.aspect = w / h;
      const visible = camera.aspect > W / H ? W / camera.aspect : H;
      camera.fov = (2 * Math.atan(visible / 2 / R.dist) * 180) / Math.PI;
      if (camera.view?.enabled) camera.clearViewOffset();
      camera.updateProjectionMatrix();
    },
    point() {},
  };
}

// ---------- The scene and its timeline ----------

// room: { photo } for the photographed room (photo: its loaded texture), or {} for the gallery.
function buildScene(T, canvas, texture, aspect, room) {
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.toneMappingExposure = 1.1;
  renderer.outputColorSpace = T.SRGBColorSpace;
  if (texture) texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(40, 16 / 9, 0.1, 40);
  const set = room.photo ? photoSet(T, scene, renderer, camera, room.photo, LIVING) : gallerySet(T, scene, renderer, camera);
  const figure = buildFigure(T, scene);
  const pic = buildPicture(T, scene, texture, aspect, set.outer);
  const { hang, stand, admire } = set;

  // ----- Timeline -----
  const walkPath = new T.CatmullRomCurve3(set.walk.map(([x, z]) => new T.Vector3(x, 0, z)), false, 'centripetal');
  const walkLen = walkPath.getLength();
  const RAMP = 0.9;
  const tWalk = 0.9;
  const walkDur = walkLen / SPEED + RAMP;
  const endTan = walkPath.getTangentAt(1);
  const endYaw = Math.atan2(endTan.x, endTan.z);
  const tTurn = tWalk + walkDur - 0.1;
  const turnDur = 0.7;
  const tLift = tTurn + 0.45;
  const liftDur = 1.5;
  const tPress = tLift + liftDur;
  const pressDur = 0.55;
  const tSettle = tPress + pressDur;
  const settleDur = 1.3;
  const tRelease = tSettle + settleDur - 0.2;
  const releaseDur = 0.7;
  const tBack = tRelease + 0.45;
  const backDur = 2.6;
  const backLen = Math.hypot(admire.x - stand.x, admire.z - stand.z);
  const backDir = new T.Vector3(admire.x - stand.x, 0, admire.z - stand.z).normalize();
  const admireYaw = Math.atan2(hang.x - admire.x, 0 - admire.z);
  const tCam = tBack + 0.9;
  const ph = { tLight: tRelease - 0.1, tBack, tCam, camDur: 5.5 };
  const END = tCam + ph.camDur;

  const wallZ = pic.depth / 2 + 0.004;
  const grip = (s) => new T.Vector3(s * (pic.ow / 2 - 0.005), -pic.oh * 0.08, 0);
  const qYaw = (yaw, roll = 0) => new T.Quaternion().setFromEuler(new T.Euler(0, yaw, roll, 'YXZ'));
  const qWall = (roll) => qYaw(0, roll);
  // Carried at the right side by its top edge, the work facing outwards (towards the camera on the way in).
  const carryY = Math.max(0.9 - pic.oh / 2, pic.oh / 2 + 0.06);
  const carryAt = (x, z, yaw, dip, sway = 0) => ({
    pos: new T.Vector3(x - Math.cos(yaw) * 0.25 + Math.sin(yaw) * 0.03, carryY - dip, z + Math.sin(yaw) * 0.25 + Math.cos(yaw) * 0.03),
    quat: qYaw(yaw - Math.PI / 2 + sway),
  });
  const topGrip = new T.Vector3(0, pic.oh / 2 + 0.01, 0);
  const sideGrip = [grip(-1), grip(1)];
  const handAt = new T.Vector3();
  const near = new T.Vector3(hang.x, hang.y + 0.05, wallZ + 0.14);

  const pose = { x: 0, z: 0, yaw: 0, cycle: 0, amp: 0, move: new T.Vector3(1, 0, 0), lean: 0.04, look: 0, hands: [new T.Vector3(), new T.Vector3()], hold: [0, 1] };

  function at(t, clock) {
    // Where the figure is and how it moves.
    let travelled;
    if (t < tTurn) {
      const { s, v } = cruise(t - tWalk, walkLen, walkDur, RAMP);
      const k = s / walkLen;
      const p = walkPath.getPointAt(k);
      const tan = walkPath.getTangentAt(k);
      pose.x = p.x;
      pose.z = p.z;
      pose.yaw = Math.atan2(tan.x, tan.z);
      pose.move.copy(tan);
      pose.amp = Math.min(1, v / SPEED);
      travelled = s;
    } else if (t < tBack) {
      const k = inOut(span(t, tTurn, turnDur));
      pose.x = stand.x;
      pose.z = stand.z;
      pose.yaw = lerp(endYaw, angleTo(endYaw, Math.PI), k);
      pose.amp = 0.35 * Math.sin(Math.PI * k);
      travelled = walkLen + 0.3 * k;
    } else {
      const { s, v } = cruise(t - tBack, backLen, backDur, 0.9);
      pose.x = stand.x + backDir.x * s;
      pose.z = stand.z + backDir.z * s;
      pose.yaw = lerp(Math.PI, angleTo(Math.PI, admireYaw), smooth(span(t, tBack + 0.8, backDur)));
      pose.move.copy(backDir);
      pose.amp = Math.min(1, v / 0.75);
      travelled = walkLen + 0.3 + s;
    }
    pose.cycle = travelled / (4 * STRIDE);
    const reaching = smooth(span(t, tLift, 0.8)) * (1 - smooth(span(t, tRelease, releaseDur)));
    pose.lean = 0.04 + 0.12 * reaching;
    pose.look = 0.35 * smooth(span(t, tLift, 1)) * (1 - smooth(span(t, tBack, 1.4))) + 0.12 * smooth(span(t, tBack + 1, 1.5));

    // The picture: carried, lifted to the wall, hooked on, levelled, let go.
    const dip = 0.035 * pose.amp * 0.5;
    const g = pic.group;
    if (t < tLift) {
      const c = carryAt(pose.x, pose.z, pose.yaw, dip, 0.05 * Math.sin(pose.cycle * Math.PI * 2) * pose.amp);
      g.position.copy(c.pos);
      g.quaternion.copy(c.quat);
    } else if (t < tPress) {
      const k = inOut(span(t, tLift, liftDur));
      const c = carryAt(pose.x, pose.z, pose.yaw, 0);
      g.position.lerpVectors(c.pos, near, k);
      g.position.y += 0.06 * Math.sin(Math.PI * k);
      g.quaternion.slerpQuaternions(c.quat, qWall(0.07), k);
    } else if (t < tSettle) {
      const k = span(t, tPress, pressDur);
      g.position.set(hang.x, hang.y + 0.05 - 0.05 * smooth((k - 0.5) * 2), wallZ + 0.14 * (1 - smooth(k * 2)));
      g.quaternion.copy(qWall(0.07));
    } else {
      // A nudge level, overshooting slightly, the way a hand straightens a frame.
      const s = Math.max(0, t - tSettle);
      const roll = 0.07 * Math.exp(-s * 3.2) * Math.cos(s * 7);
      g.position.set(hang.x, hang.y, wallZ);
      g.quaternion.copy(qWall(roll));
    }
    g.updateMatrixWorld();
    // Once it faces whoever holds it, its +x edge is at their right hand. The right hand moves from
    // the top edge to the side as the work comes round to the front; the left hand joins it.
    const round = inOut(span(t, tLift, liftDur * 0.7));
    pose.hands[0].copy(sideGrip[0]).applyMatrix4(g.matrixWorld);
    handAt.copy(topGrip).lerp(sideGrip[1], round);
    pose.hands[1].copy(handAt).applyMatrix4(g.matrixWorld);
    const letGo = 1 - smooth(span(t, tRelease, releaseDur));
    pose.hold[0] = smooth(span(t, tLift - 0.2, 0.6)) * letGo;
    pose.hold[1] = letGo;
    figure.update(pose);

    set.light(t, ph, clock);
    set.cam(t, ph, pose);
    return t >= END;
  }

  function dispose() {
    scene.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [].concat(o.material || [])) {
        for (const k of Object.keys(m)) if (m[k]?.isTexture && m[k] !== texture) m[k].dispose();
        m.dispose();
      }
      if (o.isLight) o.map?.dispose();
    });
    renderer.dispose();
    renderer.forceContextLoss();
  }

  return {
    END,
    dispose,
    resize(w, h) {
      renderer.setSize(w, h, false);
      set.resize(w, h);
    },
    point: (nx, ny) => set.point(nx, ny),
    frame(t, clock) {
      const done = at(t, clock);
      renderer.render(scene, camera);
      return done;
    },
  };
}

// ---------- The window ----------

const ROOMS = {
  living: { label: 'Living room', ratio: '3 / 2', photo: LIVING.src },
  gallery: { label: 'Gallery', ratio: '16 / 9' },
};

// art: the artwork (needs display or thumb, and width/height). plate: its plate label.
export async function openHang(art, { plate = '' } = {}) {
  closeHang();
  const returnFocus = document.activeElement;
  let roomKey = prefs.get('hangRoom', 'living');
  if (!ROOMS[roomKey]) roomKey = 'living';
  const el = document.createElement('div');
  el.className = 'hang';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'On the wall');
  el.innerHTML = `
    <div class="hang-panel" tabindex="-1">
      <header class="hang-head">
        <div class="titles"><span class="eyebrow">Signal9 Studio${plate ? ` · ${plate}` : ''}</span><h2>On the <em>wall</em></h2></div>
        <div class="spacer"></div>
        <div class="tabs hang-rooms" role="radiogroup" aria-label="Room">
          ${Object.entries(ROOMS).map(([k, r]) => `<button type="button" role="radio" data-room="${k}">${r.label}</button>`).join('')}
        </div>
        <button class="link-btn" data-act="replay" type="button" title="Play again (R)" disabled>${ic.replay}<span>Play again</span></button>
        <button class="icon-btn" data-act="close" type="button" title="Close (Esc)">${ic.close}</button>
      </header>
      <div class="hang-stage">
        <canvas aria-hidden="true"></canvas>
        <p class="hang-note">Setting up the room…</p>
        <div class="hang-caption"><span class="plate"></span><span class="title"></span></div>
      </div>
    </div>`;
  const q = (s) => el.querySelector(s);
  q('.hang-caption .plate').textContent = plate;
  q('.hang-caption .title').textContent = art.title || '';
  const stage = q('.hang-stage');
  const replayBtn = q('[data-act="replay"]');

  let T = null;
  let texture = null;
  let world = null;
  let raf = 0;
  let start = 0;
  let closed = false;
  let building = 0;

  function close() {
    if (closed) return;
    closed = true;
    if (current === api) current = null;
    cancelAnimationFrame(raf);
    observer.disconnect();
    window.removeEventListener('keydown', onKey, true);
    returnFocus?.focus?.({ preventScroll: true });
    el.style.pointerEvents = 'none';
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reducedMotion() ? 0 : 280, easing: 'ease-out', fill: 'forwards' })
      .finished.catch(() => {}).then(() => {
        el.remove();
        world?.dispose();
        texture?.dispose();
      });
  }

  function play() {
    if (!world) return;
    q('.hang-caption').classList.remove('on');
    replayBtn.disabled = true;
    const still = reducedMotion();
    start = performance.now() - (still ? world.END * 1000 : 0);
    cancelAnimationFrame(raf);
    const tick = (now) => {
      const clock = (now - start) / 1000;
      const done = world.frame(clock, still ? 0 : clock);
      if (done && replayBtn.disabled) {
        replayBtn.disabled = false;
        q('.hang-caption').classList.add('on');
      }
      // A still scene renders once; otherwise keep the light moving after the end.
      if (!(still && done)) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  const fit = () => {
    const r = stage.getBoundingClientRect();
    if (world && r.width && r.height) world.resize(r.width, r.height);
  };
  const observer = new ResizeObserver(fit);

  // Builds the chosen room on a fresh canvas (a WebGL canvas can't be reused once released).
  async function show(key) {
    roomKey = key;
    prefs.set('hangRoom', key);
    const token = ++building;
    for (const b of el.querySelectorAll('[data-room]')) {
      b.classList.toggle('on', b.dataset.room === key);
      b.setAttribute('aria-checked', String(b.dataset.room === key));
    }
    cancelAnimationFrame(raf);
    world?.dispose();
    world = null;
    replayBtn.disabled = true;
    q('.hang-caption').classList.remove('on');
    const note = q('.hang-note');
    note.textContent = 'Setting up the room…';
    note.classList.remove('gone');
    stage.style.aspectRatio = ROOMS[key].ratio;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    stage.querySelector('canvas').replaceWith(canvas);
    try {
      const room = {};
      if (ROOMS[key].photo) room.photo = await new T.TextureLoader().loadAsync(ROOMS[key].photo);
      if (closed || token !== building) return room.photo?.dispose();
      const aspect = (texture?.image?.width && texture.image.height ? texture.image.width / texture.image.height : 0)
        || (art.width && art.height ? art.width / art.height : 1);
      world = buildScene(T, canvas, texture, aspect, room);
      fit();
      note.classList.add('gone');
      play();
    } catch (err) {
      console.error(err);
      note.textContent = 'This Mac couldn’t draw the 3D room (WebGL isn’t available).';
    }
  }

  function onKey(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && /^[qwr]$/i.test(e.key)) return;
    if (e.key === 'Tab') return;
    // Keys stay in this window, so Delete or ⌘A can't act on the library behind it.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if ((e.key === 'r' || e.key === 'R') && !mod && !replayBtn.disabled) {
      e.preventDefault();
      play();
    }
  }

  el.addEventListener('click', (e) => {
    const roomBtn = e.target.closest('[data-room]');
    if (roomBtn) {
      if (T && roomBtn.dataset.room !== roomKey) show(roomBtn.dataset.room);
      return;
    }
    const b = e.target.closest('[data-act]');
    if (b && !b.disabled) (b.dataset.act === 'close' ? close() : play());
    else if (e.target === el) close();
  });
  stage.addEventListener('pointermove', (e) => {
    const r = stage.getBoundingClientRect();
    world?.point(((e.clientX - r.left) / r.width - 0.5) * 2, -((e.clientY - r.top) / r.height - 0.5) * 2);
  });
  stage.addEventListener('pointerleave', () => world?.point(0, 0));

  const api = { close };
  current = api;
  document.body.append(el);
  window.addEventListener('keydown', onKey, true);
  q('.hang-panel').focus({ preventScroll: true });
  observer.observe(stage);

  try {
    T = await loadThree();
    const src = art.display ? `/files/display/${art.display}` : art.thumb ? `/files/thumbs/${art.thumb}` : '';
    if (src) {
      texture = await new T.TextureLoader().loadAsync(src).catch(() => null);
      if (texture) texture.colorSpace = T.SRGBColorSpace;
    }
    if (closed) return texture?.dispose();
    await show(roomKey);
  } catch (err) {
    console.error(err);
    q('.hang-note').textContent = 'This Mac couldn’t draw the 3D room (WebGL isn’t available).';
  }
  return api;
}
