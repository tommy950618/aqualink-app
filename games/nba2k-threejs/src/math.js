// Small numeric helpers, the seeded RNG and shared scratch vectors (spec section 14 row 6).
import * as THREE from '../vendor/three.module.js';

export const TAU = Math.PI * 2;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Frame-rate independent exponential approach: a moves toward b by the fraction 1 - exp(-rate*dt).
export function damp(a, b, rate, dt) {
  return a + (b - a) * (1 - Math.exp(-rate * dt));
}

// Wrap an angle into (-PI, PI].
export function wrapAngle(a) {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

// Interpolate along the shortest arc between two angles.
export function lerpAngle(a, b, t) {
  return a + wrapAngle(b - a) * t;
}

// Planar (xz) distance between two points.
export function dist2(ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  return Math.sqrt(dx * dx + dz * dz);
}

// Planar squared distance, for comparisons without a sqrt.
export function dist2Sq(ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  return dx * dx + dz * dz;
}

// Normalise (x, z) into out.{x,z}; a zero vector becomes (0, 0). Returns out.
export function norm2(out, x, z) {
  const len = Math.sqrt(x * x + z * z);
  if (len > 1e-9) { out.x = x / len; out.z = z / len; } else { out.x = 0; out.z = 0; }
  return out;
}

// Hermite smoothstep of x between e0 and e1 (defaults to the unit interval).
export function smoothstep(x, e0 = 0, e1 = 1) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Deterministic PRNG (mulberry32). All gameplay randomness must flow through an instance of this.
export class Rng {
  constructor(seed) {
    this.reseed(seed);
  }

  reseed(seed) {
    this.seed = seed | 0;
    this.state = this.seed;
    this._spare = 0;
    this._hasSpare = false;
  }

  // Uniform in [0, 1).
  next() {
    let a = (this.state = (this.state + 0x6D2B79F5) | 0);
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Uniform in [a, b).
  range(a, b) {
    return a + (b - a) * this.next();
  }

  // Normal deviate via Box-Muller (the second deviate is cached, no allocation).
  gauss(mu = 0, sigma = 1) {
    if (this._hasSpare) {
      this._hasSpare = false;
      return mu + sigma * this._spare;
    }
    let u, v, s;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    this._spare = v * m;
    this._hasSpare = true;
    return mu + sigma * u * m;
  }

  // Integer in [0, n).
  int(n) {
    return Math.floor(this.next() * n);
  }

  pick(arr) {
    return arr[this.int(arr.length)];
  }

  // True with probability p.
  chance(p) {
    return this.next() < p;
  }
}

// Module-level scratch vectors for hot paths. Never hold a reference across calls.
export const SCRATCH = {
  v3a: new THREE.Vector3(),
  v3b: new THREE.Vector3(),
  v3c: new THREE.Vector3(),
  v3d: new THREE.Vector3(),
  xza: { x: 0, z: 0 },
  xzb: { x: 0, z: 0 },
  xzc: { x: 0, z: 0 },
};
