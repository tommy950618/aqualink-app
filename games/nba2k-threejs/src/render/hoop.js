/**
 * @module render/hoop
 * Stanchion, front-only glass backboard, rim, shot-clock unit, LED edge strip, the simulated net and the far hoop
 * (SPEC-v2 §6.2, PR §2.4). Court constants: rim (0, 3.048, −12.75), board x ±0.915, y 2.90–3.97, front z −13.105.
 *
 * Draws in play: low 4 (merged opaque incl. rim, glass with baked markings, net, digits); medium/high 8 (merged
 * stanchion, board frame, glass, markings, rim, digits, net, LED strip when lit). The far hoop (z = +12.75) adds 2
 * and is frustum-culled by the broadcast camera.
 *
 * `NetSim` is the pure (DOM-free) spring net: rings k = 0..R−1 × S strands, rest radius
 * `r_k = 0.2286 + (0.125 − 0.2286)·(k/(R−1))^0.85`, rest height `y_k = 3.048 − 0.45·k/(R−1)`, odd rings rotated by
 * half a strand; per vertex `a = −K·o − C·v + 0.25·(mean(neighbours) − o)·K` (K 260 s⁻², C 10 s⁻¹), |o| ≤ 0.18 m,
 * dt ≤ 1/30 split in 2 substeps (low 1); the ball pushes vertices out of a 0.132 m sphere; swish / rim / slam
 * impulses. Zero allocations per step.
 */
import * as THREE from '../../vendor/three.module.js';
import { RIM, BOARD } from '../constants.js';
import { Rng } from '../math.js';
import { TIERS, trackTexture } from './quality.js';
import { REFLECT_LAYER } from './lighting.js';
import { makeCanvas } from './floor.js';

const TAU = Math.PI * 2;
const BOARD_W = BOARD.max.x - BOARD.min.x;     // 1.83
const BOARD_H = BOARD.max.y - BOARD.min.y;     // 1.07
const BOARD_CY = 0.5 * (BOARD.min.y + BOARD.max.y);
const BOARD_Z = BOARD.max.z;                   // −13.105 (front face)
const RIM_R = 0.2286;
const NET_BOTTOM_R = 0.125;
const NET_LEN = 0.45;
const NET_K = 260;
const NET_C = 10;
const NET_MAX_O = 0.18;
const BALL_PUSH_R = 0.12 + 0.012;

/** Dunk rim shake angle (rad) t seconds after SLAM: 0.035·e^(−9t)·sin(2π·11t) for t ∈ [0, 0.6), else 0. */
export function rimShake(t) {
  if (!(t >= 0) || t >= 0.6) return 0;
  return 0.035 * Math.exp(-9 * t) * Math.sin(TAU * 11 * t);
}

// -------------------------------------------------------------------------------------------------
// Net simulation (pure)
// -------------------------------------------------------------------------------------------------

export class NetSim {
  /**
   * @param {{strands?:number, rings?:number, substeps?:number, seed?:number, rim?:{x:number,y:number,z:number}}} [opts]
   *   rings includes ring 0 on the rim (8 → k = 0..7; low 5).
   */
  constructor(opts) {
    const o = opts || {};
    this.S = o.strands || 16;
    this.R = o.rings || 8;
    this.substeps = o.substeps || 2;
    const rim = o.rim || RIM;
    this.cx = rim.x; this.cy = rim.y; this.cz = rim.z;
    this.n = this.S * this.R;
    this.rest = new Float32Array(this.n * 3);
    this.o = new Float32Array(this.n * 3);
    this.v = new Float32Array(this.n * 3);
    this.a = new Float32Array(this.n * 3);
    this.rng = new Rng((o.seed !== undefined ? o.seed : 7) ^ 0xC20D);
    this.moving = false;
    this.maxSpeed = 0;
    this.pendingSwish = 0;
    this.pendingT = 0;
    for (let k = 0; k < this.R; k++) {
      const f = k / (this.R - 1);
      const r = RIM_R + (NET_BOTTOM_R - RIM_R) * Math.pow(f, 0.85);
      const y = this.cy - NET_LEN * f;
      for (let j = 0; j < this.S; j++) {
        const ang = ((j + ((k & 1) ? 0.5 : 0)) / this.S) * TAU;
        const i = (k * this.S + j) * 3;
        this.rest[i] = this.cx + Math.cos(ang) * r;
        this.rest[i + 1] = y;
        this.rest[i + 2] = this.cz + Math.sin(ang) * r;
      }
    }
  }

  /** Rest height of ring k. */
  ringY(k) { return this.cy - NET_LEN * (k / (this.R - 1)); }

  /** Zero the state. */
  reset() {
    this.o.fill(0); this.v.fill(0);
    this.moving = false; this.maxSpeed = 0; this.pendingSwish = 0;
  }

  /**
   * Presentation sink (§1.4): 'swish' | 'rim' | 'slam'. A swish is deferred until the tracked ball's centre drops
   * below the bottom ring (or 0.35 s pass), then rings ≥ 5/7 of the depth get v.y += 1.6·s and radial −0.3·s.
   * A rim contact of strength s ∈ [0, 4] kicks every vertex k ≥ 2 horizontally by 0.4·s/4 m/s in a random direction.
   */
  impulse(kind, strength) {
    const s = strength === undefined ? 1 : Math.max(0, strength);
    if (kind === 'swish') { this.pendingSwish = Math.min(1.5, Math.max(this.pendingSwish, s || 1)); this.pendingT = 0; }
    else if (kind === 'rim') this._rimKick(Math.min(4, s));
    else if (kind === 'slam') { this._swish(Math.min(1.5, s || 1)); this._rimKick(Math.min(4, 4 * (s || 1))); }
    this.moving = true;
  }

  _swish(s) {
    const S = this.S, R = this.R;
    const k0 = Math.ceil((5 / 7) * (R - 1) - 1e-9);
    for (let k = k0; k < R; k++) {
      for (let j = 0; j < S; j++) {
        const i = (k * S + j) * 3;
        const dx = this.rest[i] - this.cx, dz = this.rest[i + 2] - this.cz;
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        this.v[i] += -0.3 * s * dx / len;
        this.v[i + 1] += 1.6 * s;
        this.v[i + 2] += -0.3 * s * dz / len;
      }
    }
  }

  _rimKick(s) {
    const mag = 0.4 * s / 4;
    for (let k = 2; k < this.R; k++) {
      for (let j = 0; j < this.S; j++) {
        const i = (k * this.S + j) * 3;
        const ang = this.rng.next() * TAU;
        this.v[i] += mag * Math.cos(ang);
        this.v[i + 2] += mag * Math.sin(ang);
      }
    }
  }

  /**
   * Integrate (once per render frame; the replay calls it with dt × 0.5 and the replayed ball).
   * @param {number} dt seconds (clamped to 1/30)
   * @param {{pos:{x,y,z}, vel?:{x,y,z}}|null} [ball]
   */
  step(dt, ball) {
    if (!(dt > 0)) return;
    const d = dt > 1 / 30 ? 1 / 30 : dt;
    const bp = ball && ball.pos ? ball.pos : null;
    if (this.pendingSwish > 0) {
      this.pendingT += d;
      if ((bp && bp.y < this.ringY(this.R - 1) && Math.abs(bp.x - this.cx) < 0.5 && Math.abs(bp.z - this.cz) < 0.5) || this.pendingT > 0.35) {
        this._swish(this.pendingSwish);
        this.pendingSwish = 0;
        this.moving = true;
      }
    }
    const near = bp && Math.abs(bp.x - this.cx) < 0.7 && Math.abs(bp.z - this.cz) < 0.7 && bp.y > this.cy - 0.9 && bp.y < this.cy + 0.4;
    if (!this.moving && !near) return;
    const h = d / this.substeps;
    for (let s = 0; s < this.substeps; s++) this._substep(h);
    if (near) this._ball(bp, ball.vel || null);
    // Rest detection.
    let vmax = 0;
    const v = this.v;
    for (let i = this.S * 3; i < v.length; i += 3) {
      const sp = v[i] * v[i] + v[i + 1] * v[i + 1] + v[i + 2] * v[i + 2];
      if (sp > vmax) vmax = sp;
    }
    this.maxSpeed = Math.sqrt(vmax);
    this.moving = this.maxSpeed > 0.005 || near;
  }

  _substep(h) {
    const S = this.S, R = this.R, o = this.o, v = this.v, a = this.a;
    for (let k = 1; k < R; k++) {
      for (let j = 0; j < S; j++) {
        const i = (k * S + j) * 3;
        const il = (k * S + (j + S - 1) % S) * 3;
        const ir = (k * S + (j + 1) % S) * 3;
        const iu = ((k - 1) * S + j) * 3;                  // ring 0 offsets stay 0 (fixed to the rim)
        const hasDown = k + 1 < R;
        const id = hasDown ? ((k + 1) * S + j) * 3 : 0;
        const nn = hasDown ? 4 : 3;
        for (let c = 0; c < 3; c++) {
          const mean = (o[il + c] + o[ir + c] + o[iu + c] + (hasDown ? o[id + c] : 0)) / nn;
          a[i + c] = -NET_K * o[i + c] - NET_C * v[i + c] + 0.25 * (mean - o[i + c]) * NET_K;
        }
      }
    }
    // Semi-implicit Euler: velocities first, then positions (stable for ω·h < 2).
    for (let i = S * 3; i < o.length; i += 3) {
      v[i] += a[i] * h; v[i + 1] += a[i + 1] * h; v[i + 2] += a[i + 2] * h;
      o[i] += v[i] * h; o[i + 1] += v[i + 1] * h; o[i + 2] += v[i + 2] * h;
      const m2 = o[i] * o[i] + o[i + 1] * o[i + 1] + o[i + 2] * o[i + 2];
      if (m2 > NET_MAX_O * NET_MAX_O) {
        const k = NET_MAX_O / Math.sqrt(m2);
        o[i] *= k; o[i + 1] *= k; o[i + 2] *= k;
        // Remove the outward velocity component at the clamp so energy does not pile up.
        const dot = (v[i] * o[i] + v[i + 1] * o[i + 1] + v[i + 2] * o[i + 2]) / (NET_MAX_O * NET_MAX_O);
        if (dot > 0) { v[i] -= dot * o[i]; v[i + 1] -= dot * o[i + 1]; v[i + 2] -= dot * o[i + 2]; }
      }
    }
  }

  // Ball contact: vertices inside the 0.132 m sphere are projected onto it and pick up 0.4× the ball velocity
  // component pointing outward (along the contact normal) plus 0.4× its downward component.
  _ball(bp, bv) {
    const o = this.o, v = this.v, rest = this.rest;
    const R2 = BALL_PUSH_R * BALL_PUSH_R;
    for (let i = this.S * 3; i < o.length; i += 3) {
      const px = rest[i] + o[i], py = rest[i + 1] + o[i + 1], pz = rest[i + 2] + o[i + 2];
      const dx = px - bp.x, dy = py - bp.y, dz = pz - bp.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= R2 || d2 < 1e-12) continue;
      const dl = Math.sqrt(d2);
      const nx = dx / dl, ny = dy / dl, nz = dz / dl;
      o[i] = bp.x + nx * BALL_PUSH_R - rest[i];
      o[i + 1] = bp.y + ny * BALL_PUSH_R - rest[i + 1];
      o[i + 2] = bp.z + nz * BALL_PUSH_R - rest[i + 2];
      const m2 = o[i] * o[i] + o[i + 1] * o[i + 1] + o[i + 2] * o[i + 2];
      if (m2 > NET_MAX_O * NET_MAX_O) {
        const k = NET_MAX_O / Math.sqrt(m2);
        o[i] *= k; o[i + 1] *= k; o[i + 2] *= k;
      }
      if (bv) {
        const out = bv.x * nx + bv.y * ny + bv.z * nz;
        if (out > 0) { v[i] += 0.4 * out * nx; v[i + 1] += 0.4 * out * ny; v[i + 2] += 0.4 * out * nz; }
        if (bv.y < 0) v[i + 1] += 0.4 * bv.y;
      }
    }
    this.moving = true;
  }

  /** Largest offset magnitude (m), for tests. */
  maxOffset() {
    let m = 0;
    const o = this.o;
    for (let i = 0; i < o.length; i += 3) {
      const d = o[i] * o[i] + o[i + 1] * o[i + 1] + o[i + 2] * o[i + 2];
      if (d > m) m = d;
    }
    return Math.sqrt(m);
  }
}

/**
 * Net cord lattice: 128² RGBA (white, alpha = cords). Two diagonal cords per cell (an X; neighbouring cells form
 * diamonds), cord width 9 px with soft 2 px edges.
 */
export function paintNetTexture(size = 128) {
  const n = size;
  const data = new Uint8Array(n * n * 4);
  const half = 4.5 * (n / 128), soft = 2 * (n / 128);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const fx = x + 0.5, fy = y + 0.5;
      // Distances to the two diagonals, wrapping so cords continue across cell edges.
      let d1 = Math.abs(fx - fy) / Math.SQRT2;
      d1 = Math.min(d1, Math.abs(fx - fy + n) / Math.SQRT2, Math.abs(fx - fy - n) / Math.SQRT2);
      let d2 = Math.abs(fx + fy - n) / Math.SQRT2;
      d2 = Math.min(d2, Math.abs(fx + fy) / Math.SQRT2, Math.abs(fx + fy - 2 * n) / Math.SQRT2);
      const d = Math.min(d1, d2);
      const t = Math.min(1, Math.max(0, (d - (half - soft / 2)) / soft));
      const a = 1 - t * t * (3 - 2 * t);
      const i = (y * n + x) * 4;
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  return data;
}

/** Mesh wrapper of a NetSim: (S+1) × R vertices (u seam duplicated), 2·S·(R−1) triangles. */
export class NetMesh {
  constructor(sim, material) {
    this.sim = sim;
    const S = sim.S, R = sim.R, W = S + 1;
    const pos = new Float32Array(W * R * 3);
    const nrm = new Float32Array(W * R * 3);
    const uv = new Float32Array(W * R * 2);
    for (let k = 0; k < R; k++) {
      for (let j = 0; j < W; j++) {
        const vi = k * W + j;
        uv[vi * 2] = j + ((k & 1) ? 0.5 : 0);
        uv[vi * 2 + 1] = (R - 1) - k;
      }
    }
    const idx = [];
    for (let k = 0; k < R - 1; k++) {
      for (let j = 0; j < S; j++) {
        const a = k * W + j, b = k * W + j + 1, c = (k + 1) * W + j, d = (k + 1) * W + j + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.nrmAttr = new THREE.BufferAttribute(nrm, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('normal', this.nrmAttr);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.index = g.index.array;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.name = 'net';
    this.mesh.frustumCulled = false;
    this.write(true);
    g.computeBoundingSphere();
  }

  /** Copy sim positions into the mesh; recompute normals only while moving (allocation-free). */
  write(force) {
    const sim = this.sim;
    if (!force && !sim.moving) return;
    const S = sim.S, R = sim.R, W = S + 1;
    const pos = this.posAttr.array, nrm = this.nrmAttr.array;
    for (let k = 0; k < R; k++) {
      for (let j = 0; j < W; j++) {
        const si = (k * S + (j % S)) * 3, vi = (k * W + j) * 3;
        pos[vi] = sim.rest[si] + sim.o[si];
        pos[vi + 1] = sim.rest[si + 1] + sim.o[si + 1];
        pos[vi + 2] = sim.rest[si + 2] + sim.o[si + 2];
      }
    }
    nrm.fill(0);
    const ix = this.index;
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
      const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
      const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      nrm[a] += nx; nrm[a + 1] += ny; nrm[a + 2] += nz;
      nrm[b] += nx; nrm[b + 1] += ny; nrm[b + 2] += nz;
      nrm[c] += nx; nrm[c + 1] += ny; nrm[c + 2] += nz;
    }
    // Merge the duplicated seam column so the seam is not lit differently.
    for (let k = 0; k < R; k++) {
      const a = (k * W) * 3, b = (k * W + S) * 3;
      for (let c = 0; c < 3; c++) { const s = nrm[a + c] + nrm[b + c]; nrm[a + c] = s; nrm[b + c] = s; }
    }
    for (let i = 0; i < nrm.length; i += 3) {
      const l = Math.sqrt(nrm[i] * nrm[i] + nrm[i + 1] * nrm[i + 1] + nrm[i + 2] * nrm[i + 2]) || 1;
      nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l;
    }
    this.posAttr.needsUpdate = true;
    this.nrmAttr.needsUpdate = true;
  }
}

// -------------------------------------------------------------------------------------------------
// Shot-clock digits (7-segment canvas)
// -------------------------------------------------------------------------------------------------

// Segment order a b c d e f g; bit i set = segment lit.
const SEG = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

/** 128×64 two-digit 7-segment display repainted only when the integer changes. */
export class ShotClockDigits {
  constructor() {
    this.w = 128; this.h = 64;
    this.canvas = makeCanvas(this.w, this.h);
    this.ctx = this.canvas && typeof this.canvas.getContext === 'function' ? this.canvas.getContext('2d') : null;
    this.texture = new THREE.CanvasTexture(this.canvas || { width: this.w, height: this.h });
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    trackTexture(this.texture, 4, false, this.w, this.h);
    this.value = undefined;
    this.repaints = 0;
    this.set(null);
  }

  /** Show an integer 0..99 (null = blank). No-op when unchanged. */
  set(n) {
    const v = n === null || n === undefined || !(n >= 0) ? null : Math.min(99, Math.floor(n));
    if (v === this.value) return false;
    this.value = v;
    this._paint();
    return true;
  }

  _paint() {
    const ctx = this.ctx;
    this.repaints++;
    if (!ctx) return;
    ctx.fillStyle = '#060607';
    ctx.fillRect(0, 0, this.w, this.h);
    const v = this.value;
    const tens = v === null ? -1 : v >= 10 ? Math.floor(v / 10) : -1;
    const ones = v === null ? -1 : v % 10;
    this._digit(ctx, 14, 6, tens);
    this._digit(ctx, 70, 6, ones);
    this.texture.needsUpdate = true;
  }

  // One digit in a 44 × 52 px box at (x, y); unlit segments drawn dark red.
  _digit(ctx, x, y, d) {
    const w = 44, h = 52, t = 7;
    const mask = d >= 0 ? SEG[d] : 0;
    const segs = [
      [x + t, y, w - 2 * t, t], [x + w - t, y + t, t, h / 2 - 1.5 * t], [x + w - t, y + h / 2 + t / 2, t, h / 2 - 1.5 * t],
      [x + t, y + h - t, w - 2 * t, t], [x, y + h / 2 + t / 2, t, h / 2 - 1.5 * t], [x, y + t, t, h / 2 - 1.5 * t],
      [x + t, y + h / 2 - t / 2, w - 2 * t, t],
    ];
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = (mask >> i) & 1 ? '#ff3b1f' : '#2a0d08';
      const s = segs[i];
      ctx.fillRect(s[0], s[1], s[2], s[3]);
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Merged geometry helpers
// -------------------------------------------------------------------------------------------------

const M = new THREE.Matrix4();
const NM = new THREE.Matrix3();
const V = new THREE.Vector3();
const CC = new THREE.Color();

/**
 * Merge parts into one indexed BufferGeometry with vertex colours (linear) and a per-vertex (roughness, metalness)
 * attribute `aRM`. part = { geo, color (hex sRGB), rough, metal, pos?:[x,y,z], rot?:[x,y,z], matrix?:Matrix4 }.
 */
export function mergeParts(parts) {
  let nv = 0, ni = 0;
  for (let p = 0; p < parts.length; p++) {
    const g = parts[p].geo;
    nv += g.getAttribute('position').count;
    ni += g.index ? g.index.count : g.getAttribute('position').count;
  }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
  const rm = new Float32Array(nv * 2), uv = new Float32Array(nv * 2);
  const idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p];
    const g = part.geo;
    if (part.matrix) M.copy(part.matrix);
    else {
      M.makeRotationFromEuler(new THREE.Euler(part.rot ? part.rot[0] : 0, part.rot ? part.rot[1] : 0, part.rot ? part.rot[2] : 0));
      if (part.pos) M.setPosition(part.pos[0], part.pos[1], part.pos[2]);
    }
    if (part.pre) M.multiply(part.pre);
    NM.getNormalMatrix(M);
    CC.setHex(part.color);
    const pa = g.getAttribute('position'), na = g.getAttribute('normal'), ua = g.getAttribute('uv');
    for (let i = 0; i < pa.count; i++) {
      V.fromBufferAttribute(pa, i).applyMatrix4(M);
      pos[(vo + i) * 3] = V.x; pos[(vo + i) * 3 + 1] = V.y; pos[(vo + i) * 3 + 2] = V.z;
      V.fromBufferAttribute(na, i).applyMatrix3(NM).normalize();
      nrm[(vo + i) * 3] = V.x; nrm[(vo + i) * 3 + 1] = V.y; nrm[(vo + i) * 3 + 2] = V.z;
      col[(vo + i) * 3] = CC.r; col[(vo + i) * 3 + 1] = CC.g; col[(vo + i) * 3 + 2] = CC.b;
      rm[(vo + i) * 2] = part.rough !== undefined ? part.rough : 0.6;
      rm[(vo + i) * 2 + 1] = part.metal !== undefined ? part.metal : 0;
      if (ua) { uv[(vo + i) * 2] = ua.getX(i); uv[(vo + i) * 2 + 1] = ua.getY(i); }
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo;
    else for (let i = 0; i < pa.count; i++) idx[io + i] = i + vo;
    vo += pa.count;
    io += g.index ? g.index.count : pa.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('aRM', new THREE.BufferAttribute(rm, 2));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/**
 * Vertex-coloured material with per-vertex roughness/metalness (`aRM`): Standard (patched) on medium/high,
 * Lambert on low. One program for every merged hoop/arena mesh.
 */
export function mergedMaterial(standard) {
  if (!standard) return new THREE.MeshLambertMaterial({ vertexColors: true });
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aRM;\nvarying vec2 vRM;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvRM = aRM;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRM;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRM.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRM.y;');
  };
  m.customProgramCacheKey = () => 'merged-rm-v2';
  return m;
}

function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }

// Board markings painter (512×256 over 1.83 × 1.07 m): 5 cm border + shooter's square 0.59 × 0.45 m whose bottom
// edge sits at rim height, white α 0.95, transparent elsewhere. `glassAlpha` > 0 bakes a white glass background
// (low tier: glass and markings in one texture).
export function drawBoardMarkings(ctx, w, h, glassAlpha) {
  const px = w / BOARD_W, py = h / BOARD_H;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (glassAlpha > 0) {
    ctx.fillStyle = 'rgba(255,255,255,' + glassAlpha + ')';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.strokeStyle = 'rgba(244,244,244,0.95)';
  ctx.lineWidth = 0.05 * px;
  const b = ctx.lineWidth / 2;
  ctx.strokeRect(b, b, w - 2 * b, h - 2 * b);
  const sqW = 0.59 * px, sqH = 0.45 * py;
  const bottom = (BOARD.max.y - RIM.y) * py;       // canvas row of the rim height (row 0 = board top)
  ctx.lineWidth = 0.05 * Math.min(px, py);
  ctx.strokeRect(w / 2 - sqW / 2 + ctx.lineWidth / 2, bottom - sqH + ctx.lineWidth / 2, sqW - ctx.lineWidth, sqH - ctx.lineWidth);
}

function canvasTexture(w, h, paint) {
  const c = makeCanvas(w, h);
  const ctx = c && typeof c.getContext === 'function' ? c.getContext('2d') : null;
  if (ctx) paint(ctx, w, h);
  const t = new THREE.CanvasTexture(c || { width: w, height: h });
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = !!ctx;
  trackTexture(t, 4, true, w, h);
  return t;
}

/** Front-only glass plane (R#6): Standard white, opacity 0.16, FrontSide, depthWrite false. */
export function createGlass(standard, map) {
  const mat = standard
    ? new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0, envMapIntensity: 1.6, depthWrite: false, side: THREE.FrontSide })
    : new THREE.MeshLambertMaterial({ color: 0xffffff, map: map || null, transparent: true, opacity: map ? 1 : 0.16, depthWrite: false, side: THREE.FrontSide });
  mat.name = 'glass';
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_W, BOARD_H), mat);
  mesh.name = 'glass';
  mesh.position.set(0, BOARD_CY, BOARD_Z);
  mesh.renderOrder = 2;
  return mesh;
}

// -------------------------------------------------------------------------------------------------
// buildHoop
// -------------------------------------------------------------------------------------------------

const RIM_PIVOT = new THREE.Vector3(0, RIM.y, BOARD_Z);          // rim hinge at the board face
const BOARD_PIVOT = new THREE.Vector3(0, 3.45, -13.25);          // arm attachment behind the board

/**
 * Build the near hoop (+ the far hoop). Returns the hoop API used by the router and the frame loop.
 * @param {THREE.Scene|null} scene
 * @param {object} quality
 * @param {{far?:boolean, seed?:number}} [opts]
 */
export function buildHoop(scene, quality, opts) {
  const o = opts || {};
  const tier = (quality && (quality.loadTier || quality.tier)) || 'low';
  const T = TIERS[tier];
  const full = T.hoop.detail === 'full';
  const root = new THREE.Group();
  root.name = 'hoop';
  const mergedMat = mergedMaterial(full);
  mergedMat.name = 'hoopMerged';

  // Stanchion (pad, pole, arm), shot-clock unit: merged.
  const armDy = 3.45 - 3.60, armDz = -13.25 - (-16.0);
  const armPitch = Math.atan2(-armDy, armDz);                  // ≈ 3° nose-down toward the board
  const stanchionParts = [
    { geo: box(1.40, 1.25, 1.90), pos: [0, 0.625, -16.6], color: 0x1c2233, rough: 0.85, metal: 0 },
    { geo: box(0.25, 2.35, 0.25), pos: [0, 1.25 + 2.35 / 2, -16.2], color: 0x2b2f36, rough: 0.4, metal: 0.6 },
    { geo: box(0.22, 0.22, 2.9), pos: [0, 0.5 * (3.60 + 3.45), 0.5 * (-16.0 - 13.25)], rot: [armPitch, 0, 0], color: 0x2b2f36, rough: 0.4, metal: 0.6 },
  ];
  // Board frame: 4 bars (4 cm deep) around the glass, bottom pad, mounting plate behind the board.
  const fb = 0.035, fd = 0.04, fz = BOARD_Z - fd / 2;
  const frameParts = [
    { geo: box(BOARD_W + 2 * fb, fb, fd), pos: [0, BOARD.max.y + fb / 2, fz], color: 0x2b2f36, rough: 0.35, metal: 0.8 },
    { geo: box(BOARD_W + 2 * fb, fb, fd), pos: [0, BOARD.min.y - fb / 2, fz], color: 0x2b2f36, rough: 0.35, metal: 0.8 },
    { geo: box(fb, BOARD_H, fd), pos: [BOARD.min.x - fb / 2, BOARD_CY, fz], color: 0x2b2f36, rough: 0.35, metal: 0.8 },
    { geo: box(fb, BOARD_H, fd), pos: [BOARD.max.x + fb / 2, BOARD_CY, fz], color: 0x2b2f36, rough: 0.35, metal: 0.8 },
    { geo: box(BOARD_W, 0.05, 0.06), pos: [0, BOARD.min.y - fb - 0.025, BOARD_Z - 0.01], color: 0x111111, rough: 0.9, metal: 0 },
    { geo: box(0.55, 0.42, 0.05), pos: [0, 3.45, -13.23], color: 0x2b2f36, rough: 0.4, metal: 0.6 },
    { geo: box(0.60, 0.25, 0.12), pos: [0, 4.15, -13.13], color: 0x15171c, rough: 0.5, metal: 0.2 },
  ];
  const rimParts = [
    { geo: new THREE.TorusGeometry(RIM_R, 0.0095, 10, 40), pos: [RIM.x, RIM.y, RIM.z], rot: [Math.PI / 2, 0, 0], color: 0xff5a1f, rough: 0.32, metal: 0.55 },
    { geo: box(0.15, 0.05, 0.20), pos: [0, RIM.y - 0.02, BOARD_Z + 0.10], color: 0xff5a1f, rough: 0.32, metal: 0.55 },
  ];

  // Groups: stanchion (static) / board (shakes 0.35×) / rim + net (shakes 1×).
  const boardGroup = new THREE.Group();
  boardGroup.name = 'boardGroup';
  boardGroup.position.copy(BOARD_PIVOT);
  const boardInner = new THREE.Group();
  boardInner.position.copy(BOARD_PIVOT).multiplyScalar(-1);
  boardGroup.add(boardInner);
  const rimGroup = new THREE.Group();
  rimGroup.name = 'rimGroup';
  rimGroup.position.copy(RIM_PIVOT);
  const rimInner = new THREE.Group();
  rimInner.position.copy(RIM_PIVOT).multiplyScalar(-1);
  rimGroup.add(rimInner);
  root.add(boardGroup, rimGroup);

  let stanchion, frame = null, rimMesh = null, glass, markings = null;
  if (full) {
    stanchion = new THREE.Mesh(mergeParts(stanchionParts), mergedMat);
    frame = new THREE.Mesh(mergeParts(frameParts), mergedMat);
    frame.name = 'boardFrame';
    rimMesh = new THREE.Mesh(mergeParts(rimParts), mergedMat);
    rimMesh.name = 'rim';
    glass = createGlass(true, null);
    const mtex = canvasTexture(512, 256, (ctx, w, h) => drawBoardMarkings(ctx, w, h, 0));
    const mmat = new THREE.MeshBasicMaterial({ map: mtex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    mmat.name = 'boardMarkings';
    markings = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_W, BOARD_H), mmat);
    markings.name = 'boardMarkings';
    markings.position.set(0, BOARD_CY, BOARD_Z + 0.001);
    markings.renderOrder = 3;
    boardInner.add(frame, glass, markings);
    rimInner.add(rimMesh);
    root.add(stanchion);
  } else {
    stanchion = new THREE.Mesh(mergeParts(stanchionParts.concat(frameParts, rimParts)), mergedMat);
    const gtex = canvasTexture(512, 256, (ctx, w, h) => drawBoardMarkings(ctx, w, h, 0.16));
    glass = createGlass(false, gtex);
    boardInner.add(glass);
    root.add(stanchion);
  }
  stanchion.name = 'stanchion';
  stanchion.castShadow = false;

  // Shot-clock digits: plane 0.50 × 0.20 on the unit's front, Basic toneMapped:false × 1.4.
  const digits = new ShotClockDigits();
  const dmat = new THREE.MeshBasicMaterial({ map: digits.texture, toneMapped: false });
  dmat.color.setScalar(1.4);
  const digitsMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.50, 0.20), dmat);
  digitsMesh.name = 'shotClockDigits';
  digitsMesh.position.set(0, 4.15, -13.13 + 0.06 + 0.002);
  (full ? boardInner : root).add(digitsMesh);

  // LED edge strip: 4 thin quads (1.5 cm) around the glass edge (medium/high).
  let strip = null;
  if (full) {
    const sw = 0.015, z = BOARD_Z + 0.002;
    const parts = [
      { geo: new THREE.PlaneGeometry(BOARD_W, sw), pos: [0, BOARD.max.y - sw / 2, z], color: 0xffffff },
      { geo: new THREE.PlaneGeometry(BOARD_W, sw), pos: [0, BOARD.min.y + sw / 2, z], color: 0xffffff },
      { geo: new THREE.PlaneGeometry(sw, BOARD_H), pos: [BOARD.min.x + sw / 2, BOARD_CY, z], color: 0xffffff },
      { geo: new THREE.PlaneGeometry(sw, BOARD_H), pos: [BOARD.max.x - sw / 2, BOARD_CY, z], color: 0xffffff },
    ];
    const smat = new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false });
    smat.color.multiplyScalar(1.6);
    strip = new THREE.Mesh(mergeParts(parts), smat);
    strip.name = 'ledStrip';
    strip.visible = false;
    strip.renderOrder = 4;
    boardInner.add(strip);
  }

  // Net.
  const netTexData = paintNetTexture(128);
  const netTex = new THREE.DataTexture(netTexData, 128, 128, THREE.RGBAFormat, THREE.UnsignedByteType);
  netTex.wrapS = THREE.RepeatWrapping;
  netTex.wrapT = THREE.RepeatWrapping;
  netTex.generateMipmaps = true;
  netTex.minFilter = THREE.LinearMipmapLinearFilter;
  netTex.magFilter = THREE.LinearFilter;
  netTex.needsUpdate = true;
  trackTexture(netTex, 4, true);
  const netMat = new THREE.MeshStandardMaterial({
    color: 0xf2f2f2, map: netTex, roughness: 0.85, metalness: 0, side: THREE.DoubleSide,
    alphaTest: 0.45, alphaToCoverage: true, envMapIntensity: 0.6,
  });
  netMat.name = 'net';
  const sim = new NetSim({ strands: T.net.strands, rings: T.net.rings, substeps: T.net.substeps, seed: o.seed });
  const netMesh = new NetMesh(sim, netMat);
  (full ? rimInner : root).add(netMesh.mesh);

  // Far hoop (z = +12.75, rotated π about y): stanchion + frame + rim merged, glass plane; low detail.
  let far = null;
  if (o.far !== false) {
    far = new THREE.Group();
    far.name = 'farHoop';
    const R = new THREE.Matrix4().makeRotationY(Math.PI);
    const farParts = [];
    const src = stanchionParts.concat(frameParts);
    for (let i = 0; i < src.length; i++) {
      const p = src[i];
      farParts.push({ geo: box(p.geo.parameters.width, p.geo.parameters.height, p.geo.parameters.depth), pos: p.pos, rot: p.rot, color: p.color, rough: p.rough, metal: p.metal });
    }
    farParts.push({ geo: new THREE.TorusGeometry(RIM_R, 0.0095, 8, 24), pos: [RIM.x, RIM.y, RIM.z], rot: [Math.PI / 2, 0, 0], color: 0xff5a1f, rough: 0.32, metal: 0.55 });
    farParts.push({ geo: box(0.15, 0.05, 0.20), pos: [0, RIM.y - 0.02, BOARD_Z + 0.10], color: 0xff5a1f, rough: 0.32, metal: 0.55 });
    const farGeo = mergeParts(farParts);
    farGeo.applyMatrix4(R);
    farGeo.computeBoundingSphere();
    const farMesh = new THREE.Mesh(farGeo, mergedMat);
    farMesh.name = 'farHoopMerged';
    const farGlass = createGlass(full, null);
    farGlass.position.z = -BOARD_Z;
    farGlass.rotation.y = Math.PI;
    far.add(farMesh, farGlass);
    root.add(far);
  }
  // Rebuilt the parts above from parameters, so the originals can be released.
  for (let i = 0; i < stanchionParts.length; i++) stanchionParts[i].geo.dispose();

  // Reflection layer: rim, net, frame, stanchion.
  const reflect = [stanchion, netMesh.mesh];
  if (frame) reflect.push(frame);
  if (rimMesh) reflect.push(rimMesh);
  for (let i = 0; i < reflect.length; i++) reflect[i].layers.enable(REFLECT_LAYER);

  if (scene) scene.add(root);

  let shakeT = -1;
  let stripT = 0;
  const hoop = {
    group: root,
    stanchion, frame, rimMesh, glass, markings, digits, digitsMesh, strip, far,
    netSim: sim,
    netMesh: netMesh.mesh,
    /** Presentation sink `net.impulse(kind, strength)`. */
    net: { impulse(kind, strength) { sim.impulse(kind, strength); }, sim },
    /** Presentation sink `rim.shake(t0)`: start the dunk shake t0 seconds in (default 0). */
    rim: { shake(t0) { shakeT = t0 > 0 ? t0 : 0; if (!full) sim.impulse('rim', 4); } },
    /** Shot-clock digits (integer seconds; null blank). */
    setShotClock(n) { return digits.set(n); },
    /** LED edge strip on for `seconds` (clock 0 / final buzzer: 1.0 s). */
    flashStrip(seconds) { stripT = seconds === undefined ? 1.0 : seconds; if (strip) strip.visible = stripT > 0; },
    /**
     * Per frame: net sim with the (rendered) ball, shake, strip timer. Allocation-free.
     * @param {number} dt
     * @param {{pos, vel}|null} ball
     */
    update(dt, ball) {
      sim.step(dt, ball);
      netMesh.write(false);
      if (shakeT >= 0) {
        shakeT += dt;
        const a = rimShake(shakeT);
        rimGroup.rotation.x = a;
        boardGroup.rotation.x = 0.35 * a;
        if (shakeT >= 0.6) { shakeT = -1; rimGroup.rotation.x = 0; boardGroup.rotation.x = 0; }
      }
      if (stripT > 0) {
        stripT -= dt;
        if (stripT <= 0 && strip) strip.visible = false;
      }
    },
    dispose() {
      if (root.parent) root.parent.remove(root);
      root.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) { if (obj.material.map) obj.material.map.dispose(); obj.material.dispose(); }
      });
      netTex.dispose();
      digits.texture.dispose();
    },
  };
  return hoop;
}
