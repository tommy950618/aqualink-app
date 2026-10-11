/**
 * @module render/ballvis
 * Ball look and visual spin (SPEC-v2 §6.3, PR §3). Physics stays in `ball.js` (WP4); this module only renders.
 *
 * `paintBall(size)` (pure, Node-testable) paints an equirectangular albedo + roughness (alpha) texture and a
 * tangent-space normal map. Every texel is mapped to its unit direction on the sphere with three's SphereGeometry
 * convention (φ = 2πu, θ = π(1 − v), n = (−cos φ sin θ, cos θ, sin φ sin θ)), so all features are uniform on the
 * sphere (no polar pinching):
 *  - 8-panel seams: great circles |n.x| < w and |n.z| < w, plus two curved seams
 *    `| |n.y| − (0.62 + 0.25·cos 2φ') | < w` with φ' = atan2(n.z, n.x) − 45°; w = 0.029; roughness 0.85, groove
 *    height −1 with a 1-texel bevel; colour #1a1410 in the core (d < 0.8 w) blending to leather on the groove walls
 *    (with the full 7 mm band dark the four seams would cover 11.2 % of the sphere, outside the 6–10 % check);
 *  - pebbles: 3D cellular noise on n / 0.0115 (≈ 2.8 mm cells): height smoothstep(0.52, 0, F1)·0.25, albedo
 *    × (0.96 + 0.08·hash), roughness 0.70 + 0.06·hash;
 *  - base #c4521c with ±3 % large-scale value noise; normal = Sobel of the height × 2.0. No logos, no text.
 *
 * `BallVisual.update(dt, ball)` places the mesh (held ball = the rendered hand socket via an injected resolver) and
 * integrates a visual angular velocity `q ← exp(ω dt / 2) ⊗ q` (world-space ω) from the ball state: held 0 (Kyrie
 * finger spin (0, 2π·3, 0)), dribble ⟂ travel with |ω| = 0.5·|v_y|/r, shot backspin 2π·2.2, chest/overhead pass
 * backspin 2π·3.0, bounce pass topspin 2π·2.0, rolling ω = cross(up, v)/r, rim contact ω·0.6 ± 3 rad/s, floor bounce
 * ω = 0.6·cross(up, v_xz)/r + 0.4·ω. Contacts are detected from velocity jumps. Zero allocations per frame.
 */
import * as THREE from '../../vendor/three.module.js';
import { BALL } from '../constants.js';
import { Rng } from '../math.js';
import { TIERS, trackTexture } from './quality.js';
import { REFLECT_LAYER } from './lighting.js';

export const BALL_R = BALL.R;                 // 0.12 m
export const SEAM_W = 0.029;                 // groove half-width in n units (7 mm channel)
export const SEAM_CORE = 0.8 * SEAM_W;       // dark rubber core of the channel
export const PEBBLE_CELL = 0.0115;
const TAU = Math.PI * 2;
const BASE = [0xc4 / 255, 0x52 / 255, 0x1c / 255];
const SEAM_RGB = [0x1a / 255, 0x14 / 255, 0x10 / 255];

/** Unit direction of texel (u, v) on three's SphereGeometry; writes out[0..2]. */
export function texelDir(u, v, out) {
  const phi = u * TAU, theta = (1 - v) * Math.PI;
  const st = Math.sin(theta);
  out[0] = -Math.cos(phi) * st;
  out[1] = Math.cos(theta);
  out[2] = Math.sin(phi) * st;
  return out;
}

/**
 * Distance (in n units) from direction n to the nearest of the 8-panel seams. The curved seams use
 * cos 2φ' with φ' = atan2(n.z, n.x) − 45°, i.e. cos 2φ' = sin(2·atan2(n.z, n.x)) = 2·n.x·n.z / (n.x² + n.z²).
 */
export function seamDistance(nx, ny, nz) {
  const d1 = Math.abs(nx);
  const d2 = Math.abs(nz);
  const r2 = nx * nx + nz * nz;
  const c2 = r2 > 1e-12 ? (2 * nx * nz) / r2 : 0;
  const d3 = Math.abs(Math.abs(ny) - (0.62 + 0.25 * c2));
  return d1 < d2 ? (d1 < d3 ? d1 : d3) : (d2 < d3 ? d2 : d3);
}

const PEB = { f1: 0, id: 0 };

/**
 * 3D cellular noise at p = n / 0.0115: F1 (cell units) and the id of the nearest feature's cell. Feature points
 * are jittered inside [0.15, 0.85] of their cell (three 10-bit fields of one hash), so the 2×2×2 neighbourhood
 * toward the sample is exact enough. Returns a module scratch object.
 */
export function pebbleField(nx, ny, nz) {
  const px = nx / PEBBLE_CELL, py = ny / PEBBLE_CELL, pz = nz / PEBBLE_CELL;
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  const fx = px - ix, fy = py - iy, fz = pz - iz;
  const ox = fx < 0.5 ? -1 : 0, oy = fy < 0.5 ? -1 : 0, oz = fz < 0.5 ? -1 : 0;
  let best = 1e9, bh = 0;
  for (let a = 0; a < 2; a++) {
    for (let b = 0; b < 2; b++) {
      for (let c = 0; c < 2; c++) {
        const cx = ix + ox + a, cy = iy + oy + b, cz = iz + oz + c;
        const h = hashCell(cx, cy, cz);
        const dx = px - (cx + 0.15 + 0.7 * ((h & 1023) / 1024));
        const dy = py - (cy + 0.15 + 0.7 * (((h >>> 10) & 1023) / 1024));
        const dz = pz - (cz + 0.15 + 0.7 * (((h >>> 20) & 1023) / 1024));
        const d = dx * dx + dy * dy + dz * dz;
        if (d < best) { best = d; bh = h; }
      }
    }
  }
  PEB.f1 = Math.sqrt(best);
  PEB.id = (Math.imul(bh, 0x9e3779b1) >>> 0) / 4294967296;
  return PEB;
}

function hashCell(x, y, z) {
  let h = Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

// Smooth large-scale variation in [−1, 1] over the sphere, separable in (φ, θ) so it is precomputed per column and
// per row. The φ-dependent term is multiplied by sin θ, so it vanishes at the poles (no pinching).
function largeRow(theta) { return Math.sin(theta) * Math.cos(1.5 * theta); }
function largeRowB(theta) { return 0.4 * Math.cos(3 * theta + 0.5); }
function largeCol(phi) { return 0.6 * Math.cos(2 * phi + 0.7); }

/**
 * Paint the ball textures.
 * @param {number} size  width (512 or 1024); height = size / 2
 * @param {{normal?:boolean}} [opts]  normal map (default true)
 * @returns {{albedo:Uint8Array, normal:(Uint8Array|null), width:number, height:number, height01:Float32Array}}
 */
export function paintBall(size, opts) {
  const W = size | 0, H = W >> 1;
  const wantNormal = !(opts && opts.normal === false);
  const albedo = new Uint8Array(W * H * 4);
  const hgt = new Float32Array(W * H);
  const n = [0, 0, 0];
  const bevel = Math.PI / H;          // one texel in n units (latitude step)
  const cphi = new Float32Array(W), sphi = new Float32Array(W), lcol = new Float32Array(W);
  for (let i = 0; i < W; i++) {
    const phi = ((i + 0.5) / W) * TAU;
    cphi[i] = Math.cos(phi); sphi[i] = Math.sin(phi); lcol[i] = largeCol(phi);
  }
  for (let j = 0; j < H; j++) {
    const theta = (1 - (j + 0.5) / H) * Math.PI;      // texelDir convention, per row
    const st = Math.sin(theta), ct = Math.cos(theta);
    const lrA = largeRow(theta), lrB = largeRowB(theta);
    for (let i = 0; i < W; i++) {
      n[0] = -cphi[i] * st; n[1] = ct; n[2] = sphi[i] * st;
      const sd = seamDistance(n[0], n[1], n[2]);
      const k = j * W + i;
      const o = k * 4;
      let r, g, b, rough, h;
      if (sd < SEAM_CORE) {
        r = SEAM_RGB[0]; g = SEAM_RGB[1]; b = SEAM_RGB[2]; rough = 0.85; h = -1;
      } else if (sd < SEAM_W) {
        // Groove walls (outer fifth of the 7 mm channel): still at the groove depth, colour blends from the rubber
        // core to shaded leather (smoothstep), so the visible dark seam is ≈ 5.6 mm and covers ≈ 9 % of the ball.
        const tt = (sd - SEAM_CORE) / (SEAM_W - SEAM_CORE);
        const sm = tt * tt * (3 - 2 * tt);
        r = SEAM_RGB[0] + (BASE[0] * 0.8 - SEAM_RGB[0]) * sm;
        g = SEAM_RGB[1] + (BASE[1] * 0.8 - SEAM_RGB[1]) * sm;
        b = SEAM_RGB[2] + (BASE[2] * 0.8 - SEAM_RGB[2]) * sm;
        rough = 0.85; h = -1;
      } else {
        const P = pebbleField(n[0], n[1], n[2]);
        const tt = Math.max(0, Math.min(1, (0.52 - P.f1) / 0.52));
        const sm = tt * tt * (3 - 2 * tt);
        const hp = sm * 0.25;
        const big = 1 + 0.03 * (lcol[i] * lrA + lrB);
        const cellK = (0.96 + 0.08 * P.id) * big * (0.96 + 0.07 * sm);   // valleys between pebbles slightly darker (mean ≈ 1)
        r = BASE[0] * cellK; g = BASE[1] * cellK; b = BASE[2] * cellK;
        rough = 0.70 + 0.06 * P.id;
        // Seam bevel: ramp from the groove floor (−1) to the surface over one texel.
        const e = (sd - SEAM_W) / bevel;
        h = e < 1 ? -1 + e * (1 + hp) : hp;
      }
      albedo[o] = (Math.min(1, r) * 255 + 0.5) | 0;
      albedo[o + 1] = (Math.min(1, g) * 255 + 0.5) | 0;
      albedo[o + 2] = (Math.min(1, b) * 255 + 0.5) | 0;
      albedo[o + 3] = (rough * 255 + 0.5) | 0;
      hgt[k] = h;
    }
  }
  let normal = null;
  if (wantNormal) {
    normal = new Uint8Array(W * H * 4);
    const s = 2.0;
    for (let j = 0; j < H; j++) {
      // Sobel (u wraps, v clamps); neighbour rows/columns resolved once per row / per texel.
      const rm = (j > 0 ? j - 1 : 0) * W, r0 = j * W, rp = (j < H - 1 ? j + 1 : H - 1) * W;
      for (let i = 0; i < W; i++) {
        const im = i > 0 ? i - 1 : W - 1, ip = i < W - 1 ? i + 1 : 0;
        const a = hgt[rm + im], b = hgt[rm + i], c = hgt[rm + ip];
        const d = hgt[r0 + im], f = hgt[r0 + ip];
        const g = hgt[rp + im], h = hgt[rp + i], k = hgt[rp + ip];
        const dx = (c + 2 * f + k - a - 2 * d - g) / 8;
        const dy = (g + 2 * h + k - a - 2 * b - c) / 8;
        let nx = -s * dx, ny = -s * dy, nz = 1;
        const l = 1 / Math.sqrt(nx * nx + ny * ny + 1);
        nx *= l; ny *= l; nz = l;
        const o = (r0 + i) * 4;
        normal[o] = ((nx * 0.5 + 0.5) * 255 + 0.5) | 0;
        normal[o + 1] = ((ny * 0.5 + 0.5) * 255 + 0.5) | 0;
        normal[o + 2] = ((nz * 0.5 + 0.5) * 255 + 0.5) | 0;
        normal[o + 3] = 255;
      }
    }
  }
  return { albedo, normal, width: W, height: H, height01: hgt };
}

// -------------------------------------------------------------------------------------------------
// Spin rules (pure helpers)
// -------------------------------------------------------------------------------------------------

/** Backspin axis for travel (dirX, dirZ): normalize(cross(dir, up)) — the top of the ball turns back. */
export function backspinAxis(dirX, dirZ, out) {
  // cross((dx, 0, dz), (0, 1, 0)) = (−dz, 0, dx)
  let x = -dirZ, z = dirX;
  const l = Math.sqrt(x * x + z * z);
  if (l < 1e-9) { x = 1; z = 0; } else { x /= l; z /= l; }
  out.x = x; out.y = 0; out.z = z;
  return out;
}

/** Shot backspin ω = 2π·2.2 · backspinAxis(dir). */
export function shotSpin(dirX, dirZ, out) {
  backspinAxis(dirX, dirZ, out);
  out.x *= TAU * 2.2; out.z *= TAU * 2.2;
  return out;
}

/** Pass spin: bounce pass topspin 2π·2.0, other passes backspin 2π·3.0. */
export function passSpin(kind, dirX, dirZ, out) {
  backspinAxis(dirX, dirZ, out);
  const w = kind === 'bounce' ? -TAU * 2.0 : TAU * 3.0;
  out.x *= w; out.z *= w;
  return out;
}

/** Rolling without slipping: ω = cross(up, v) / r = (v.z, 0, −v.x) / r. */
export function rollingSpin(vx, vz, out, r = BALL_R) {
  out.x = vz / r; out.y = 0; out.z = -vx / r;
  return out;
}

// -------------------------------------------------------------------------------------------------
// BallVisual
// -------------------------------------------------------------------------------------------------

const W_TMP = new THREE.Vector3();
const AXIS = new THREE.Vector3();
const DQ = new THREE.Quaternion();
const POS = new THREE.Vector3();
const VEL = new THREE.Vector3();
const FREE = { flight: 1, pass: 1, loose: 1, scored: 1 };

export class BallVisual {
  /**
   * @param {THREE.Scene|null} scene
   * @param {object} quality
   * @param {{seed?:number, resolveHeld?:(ball:object, out:THREE.Vector3)=>boolean}} [opts]
   *   resolveHeld: rendered socket of the owner's ball hand (WP9: `animator.renderSocket(ball1_s, out)`); when it
   *   returns false or is absent, the sim position `ball.pos` is used.
   */
  constructor(scene, quality, opts) {
    const o = opts || {};
    const tier = (quality && (quality.loadTier || quality.tier)) || 'low';
    const B = TIERS[tier].ball;
    const paint = paintBall(B.tex[0], { normal: B.normal });
    const map = new THREE.DataTexture(paint.albedo, paint.width, paint.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = THREE.RepeatWrapping;
    map.generateMipmaps = true;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.magFilter = THREE.LinearFilter;
    map.anisotropy = 4;
    map.needsUpdate = true;
    trackTexture(map, 4, true);
    let normalMap = null;
    if (paint.normal) {
      normalMap = new THREE.DataTexture(paint.normal, paint.width, paint.height, THREE.RGBAFormat, THREE.UnsignedByteType);
      normalMap.wrapS = THREE.RepeatWrapping;
      normalMap.generateMipmaps = true;
      normalMap.minFilter = THREE.LinearMipmapLinearFilter;
      normalMap.needsUpdate = true;
      trackTexture(normalMap, 4, true);
    }
    let material;
    if (B.material === 'standard') {
      material = new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.72, metalness: 0, envMapIntensity: 0.8 });
      if (normalMap) material.normalScale.set(0.6, 0.6);
      // Roughness from the albedo alpha: 0.72 × (a / 0.72) = a (seams 0.85, pebbles 0.70–0.76).
      material.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <roughnessmap_fragment>',
          '#include <roughnessmap_fragment>\n\troughnessFactor *= texture2D( map, vMapUv ).a / 0.72;'
        );
      };
      material.customProgramCacheKey = () => 'ball-v2';
    } else {
      material = new THREE.MeshLambertMaterial({ map });
    }
    material.name = 'ball';
    this.map = map;
    this.normalMap = normalMap;
    this.material = material;
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, B.segments[0], B.segments[1]), material);
    this.mesh.name = 'ballVisual';
    this.mesh.castShadow = TIERS[(quality && quality.tier) || tier].shadows.map;
    this.mesh.receiveShadow = false;
    this.mesh.layers.enable(REFLECT_LAYER);
    this.resolveHeld = o.resolveHeld || null;
    this.rng = new Rng((o.seed !== undefined ? o.seed : 7) ^ 0xA11CE5);
    this.omega = new THREE.Vector3();
    this.prevPos = new THREE.Vector3(0, BALL_R, 0);
    this.prevVel = new THREE.Vector3();
    this.prevState = '';
    this.hasPrev = false;
    if (scene) scene.add(this.mesh);
  }

  /** Runtime tier switch: shadow casting (map on medium/high). */
  setTier(tier) { this.mesh.castShadow = !!(TIERS[tier] && TIERS[tier].shadows.map); }

  /**
   * Per frame (after animation evaluate).
   * @param {number} dt frame seconds
   * @param {object} ball  WP4 Ball: { state, pos, vel, owner, passInfo:{kind}, spinMode?:'finger'|'underspin', visible? }
   */
  update(dt, ball) {
    if (!ball) return;
    const state = ball.state || 'loose';
    const held = state === 'held' || state === 'dribble';
    if (!(held && this.resolveHeld && this.resolveHeld(ball, POS))) {
      const p = ball.pos || ball.position;
      POS.set(p.x, p.y, p.z);
    }
    if (!(POS.x === POS.x && POS.y === POS.y && POS.z === POS.z)) return;   // NaN guard
    const free = FREE[state] === 1;
    // Visual velocity: the sim velocity for free balls, otherwise the rendered displacement.
    if (free && ball.vel) VEL.set(ball.vel.x, ball.vel.y, ball.vel.z);
    else if (this.hasPrev && dt > 1e-5) VEL.subVectors(POS, this.prevPos).divideScalar(dt);
    else VEL.set(0, 0, 0);

    const w = this.omega;
    const entered = state !== this.prevState;
    if (state === 'held') {
      if (ball.spinMode === 'finger') w.set(0, TAU * 3, 0);
      else w.set(0, 0, 0);
    } else if (state === 'dribble') {
      // Axis ⟂ horizontal travel (owner velocity if known), |ω| = 0.5·|v_y| / r.
      const own = ball.owner && (ball.owner.vel || ball.owner.velocity);
      let tx = own ? own.x : VEL.x, tz = own ? own.z : VEL.z;
      if (tx * tx + tz * tz < 1e-4) { tx = 0; tz = -1; }
      backspinAxis(tx, tz, W_TMP);
      const mag = (0.5 * Math.abs(VEL.y)) / BALL_R;
      w.set(-W_TMP.x * mag, 0, -W_TMP.z * mag);     // forward roll with the travel direction
    } else if (entered && state === 'flight') {
      shotSpin(VEL.x, VEL.z, w);
      if (ball.spinMode === 'underspin') w.multiplyScalar(3.0 / 2.2);   // finger-roll release: heavier underspin
    } else if (entered && state === 'pass') {
      passSpin(ball.passInfo && ball.passInfo.kind, VEL.x, VEL.z, w);
    } else if (free && this.hasPrev && dt > 1e-5) {
      // Contact detection: velocity change beyond gravity → floor bounce (near the floor) or rim/board contact.
      const ex = this.prevVel.x, ey = this.prevVel.y - BALL.G * dt, ez = this.prevVel.z;
      const jx = VEL.x - ex, jy = VEL.y - ey, jz = VEL.z - ez;
      const jump = Math.sqrt(jx * jx + jy * jy + jz * jz);
      if (jump > 0.8) {
        if (POS.y < BALL_R + 0.15) {
          rollingSpin(VEL.x, VEL.z, W_TMP);
          w.multiplyScalar(0.4).addScaledVector(W_TMP, 0.6);
        } else {
          w.multiplyScalar(0.6);
          w.x += this.rng.range(-3, 3); w.y += this.rng.range(-3, 3); w.z += this.rng.range(-3, 3);
        }
      } else if (POS.y < BALL_R + 0.02 && Math.abs(VEL.y) < 0.3) {
        rollingSpin(VEL.x, VEL.z, w);              // rolling / resting
      }
    }
    // Integrate q ← exp(ω dt / 2) ⊗ q (world-space angular velocity).
    const wl = w.length();
    if (wl > 1e-6 && dt > 0) {
      AXIS.copy(w).divideScalar(wl);
      DQ.setFromAxisAngle(AXIS, wl * dt);
      this.mesh.quaternion.premultiply(DQ).normalize();
    }
    this.mesh.position.copy(POS);
    this.mesh.visible = ball.visible !== false;
    this.prevPos.copy(POS);
    this.prevVel.copy(VEL);
    this.prevState = state;
    this.hasPrev = true;
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.map.dispose();
    if (this.normalMap) this.normalMap.dispose();
  }
}
