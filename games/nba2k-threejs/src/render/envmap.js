/**
 * @module render/envmap
 * Procedural arena environment map (SPEC-v2 §6.1, PR §1.4). Medium/high only: a throw-away "arena" scene (dark
 * shell, warm floor, crowd-speckle stands band, eight HDR ceiling light banks, the jumbotron and the LED ribbon) is
 * baked once with `PMREMGenerator.fromScene(scene, 0, 0.1, 120, {size, position: (0, 1.6, −7)})` during the loading
 * "compile" phase; the scene and generator are disposed and the PMREM texture is kept (`scene.environment`). Low
 * tier: no environment (the hemisphere light at 1.10 carries the fill).
 *
 * All materials are MeshBasicMaterial with `fog: false`; values > 1 survive because PMREM targets are half-float.
 */
import * as THREE from '../../vendor/three.module.js';
import { Rng } from '../math.js';
import { TIERS, trackTexture } from './quality.js';

/** Crowd shirt palette (PR §2.8), used for the stands speckle band. */
const SPECKLE = [0xf2f2f2, 0x1c1c1c, 0x3a4a6b, 0x6b3a3a, 0x4e6b3a, 0xc9b38a, 0x808a99, 0x2e5f8a, 0x8a2e5f, 0xd0d0c8, 0x5a5a5a, 0xb05a2a];

function basic(color, mul, side) {
  const m = new THREE.MeshBasicMaterial({ color, fog: false, side: side || THREE.FrontSide, toneMapped: false });
  if (mul !== undefined && mul !== 1) m.color.multiplyScalar(mul);
  return m;
}

// Shell box 70 × 30 × 70 centred (0, 15, −7), BackSide, vertex colours by height:
// y = 0 #22252f, y = 8 #11131a, top #07080b; the ceiling face is #050608.
function shell() {
  const g = new THREE.BoxGeometry(70, 30, 70, 1, 6, 1);
  g.translate(0, 15, -7);
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  const c0 = new THREE.Color(0x22252f), c8 = new THREE.Color(0x11131a), cTop = new THREE.Color(0x07080b), cCeil = new THREE.Color(0x050608);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (nrm.getY(i) < -0.5 && y > 29.9) c.copy(cCeil);          // ceiling face (normal points down)
    else if (y <= 8) c.copy(c0).lerp(c8, y / 8);
    else c.copy(c8).lerp(cTop, (y - 8) / 22);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, toneMapped: false });
  return new THREE.Mesh(g, m);
}

// 64 × 16 speckle texture of crowd colours (DataTexture; equivalent of the spec's small canvas, Node-safe).
function speckleTexture(rng) {
  const w = 64, h = 16;
  const data = new Uint8Array(w * h * 4);
  const c = new THREE.Color();
  for (let i = 0; i < w * h; i++) {
    c.setHex(SPECKLE[rng.int(SPECKLE.length)]);
    const k = 0.6 + 0.4 * rng.next();
    data[i * 4] = Math.round(255 * Math.min(1, c.r * k));
    data[i * 4 + 1] = Math.round(255 * Math.min(1, c.g * k));
    data[i * 4 + 2] = Math.round(255 * Math.min(1, c.b * k));
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/**
 * Build the arena environment (medium/high) and assign it to `scene.environment`.
 * @param {THREE.WebGLRenderer} renderer
 * @param {object} quality  (loadTier decides: built only when the start tier is medium/high, §7.4)
 * @param {THREE.Scene} [scene]  receives `environment` and `environmentIntensity = 0.55`
 * @returns {THREE.Texture|null}
 */
export function buildArenaEnv(renderer, quality, scene) {
  const tier = (quality && (quality.loadTier || quality.tier)) || 'low';
  const size = TIERS[tier] ? TIERS[tier].env.size : 0;
  if (!size || !renderer) {
    if (scene) scene.environment = null;
    return null;
  }
  const env = new THREE.Scene();
  const disposables = [];
  const add = (mesh) => { env.add(mesh); disposables.push(mesh); return mesh; };

  add(shell());

  // Warm floor 30 × 18 at y 0.01, centre (0, 0, −7).
  const floor = add(new THREE.Mesh(new THREE.PlaneGeometry(30, 18), basic(0xb9824e, 0.9)));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.01, -7);

  // Stands band: open cylinder r 24, y 2–10, seen from inside, speckled crowd colours × 0.5.
  const speckle = speckleTexture(new Rng(0xC20D));
  speckle.repeat.set(4, 1);
  const bandMat = basic(0xffffff, 0.5, THREE.BackSide);
  bandMat.map = speckle;
  const band = add(new THREE.Mesh(new THREE.CylinderGeometry(24, 24, 8, 32, 1, true), bandMat));
  band.position.set(0, 6, -7);

  // Eight ceiling light banks 7 × 1.4 facing down at y 24 (HDR colour (1, 0.96, 0.9) × 12).
  const bankGeo = new THREE.PlaneGeometry(7, 1.4);
  bankGeo.rotateX(Math.PI / 2);                              // normal → −Y (facing the floor)
  const bankMat = new THREE.MeshBasicMaterial({ fog: false, toneMapped: false, side: THREE.DoubleSide });
  bankMat.color.setRGB(12, 0.96 * 12, 0.9 * 12, THREE.LinearSRGBColorSpace);
  const xs = [-9, -3, 3, 9], zs = [-12, -2];
  for (let i = 0; i < xs.length; i++) {
    for (let j = 0; j < zs.length; j++) {
      const b = add(new THREE.Mesh(bankGeo, bankMat));
      b.position.set(xs[i], 24, zs[j]);
    }
  }

  // Jumbotron plane 10 × 4.5 at (0, 9.5, −27), #3050a0 × 2.5.
  const jumbo = add(new THREE.Mesh(new THREE.PlaneGeometry(10, 4.5), basic(0x3050a0, 2.5)));
  jumbo.position.set(0, 9.5, -27);

  // LED ribbon: a ring of boxes y 0.4–1.2 behind the baseline and along the sidelines, #ff8a30 × 1.8.
  const ledMat = basic(0xff8a30, 1.8);
  const ribbon = [
    [17, 0.8, 0.15, 0, -16.9], [0.15, 0.8, 18, -10.4, -7], [0.15, 0.8, 18, 10.4, -7],
  ];
  for (let i = 0; i < ribbon.length; i++) {
    const r = ribbon[i];
    const m = add(new THREE.Mesh(new THREE.BoxGeometry(r[0], r[1], r[2]), ledMat));
    m.position.set(r[3], 0.8, r[4]);
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(env, 0, 0.1, 120, { size, position: new THREE.Vector3(0, 1.6, -7) });
  pmrem.dispose();
  // Dispose the throw-away scene.
  const seen = new Set();
  for (let i = 0; i < disposables.length; i++) {
    const m = disposables[i];
    if (!seen.has(m.geometry)) { seen.add(m.geometry); m.geometry.dispose(); }
    if (!seen.has(m.material)) { seen.add(m.material); if (m.material.map) m.material.map.dispose(); m.material.dispose(); }
  }
  const tex = target.texture;
  // PMREM is a half-float RGBA target (8 B/px), no mip chain (its levels are packed in the atlas).
  trackTexture(target, 8, false);
  tex.userData.pmremTarget = target;
  if (scene) {
    scene.environment = tex;
    scene.environmentIntensity = 0.55;
  }
  return tex;
}
