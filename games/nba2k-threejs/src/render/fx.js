/**
 * @module render/fx
 * Small effects (SPEC-v2 §6.2, PR §2.8–§2.9):
 *  - `ChalkBurst`: 120 points (32² soft disc #f6f3ea, 0.05–0.12 m), radial 1.2–2.0 + up 0.8–1.6 m/s, drag 2.5 /s,
 *    gravity −0.6 m/s², alpha 0.6 → 0 over 1.5 s; 1 draw while alive (LeBron intro / lineup).
 *  - `CameraFlashes` (high): 64 additive points of size 0.35 at random occupied seats, each 70 ms; bursts dunk 40 over
 *    1.2 s, three 20 over 0.8 s, game-winner 64 over 2.0 s.
 *  - `ControlRing`: `RingGeometry(0.42, 0.50, 48)` flat at y 0.006 under the controlled player, team UI colour α 0.85,
 *    radius × shoulderJoints/0.46, pulse 1.25 → 1.0 over 0.25 s on control change.
 * Randomness is cosmetic (`Rng(seed ^ 0xC20D)`); updates are allocation-free.
 */
import * as THREE from '../../vendor/three.module.js';
import { Rng } from '../math.js';
import { TIERS, trackTexture } from './quality.js';

let DISC = null;

/** Shared 32² soft white disc (alpha falloff), DataTexture. */
export function softDisc() {
  if (DISC) return DISC;
  const n = 32;
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n * 2 - 1, dy = (y + 0.5) / n * 2 - 1;
      const r = Math.sqrt(dx * dx + dy * dy);
      const a = r >= 1 ? 0 : Math.pow(1 - r, 1.5);
      const i = (y * n + x) * 4;
      d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = Math.round(a * 255);
    }
  }
  DISC = new THREE.DataTexture(d, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  DISC.generateMipmaps = true;
  DISC.minFilter = THREE.LinearMipmapLinearFilter;
  DISC.magFilter = THREE.LinearFilter;
  DISC.needsUpdate = true;
  trackTexture(DISC, 4, true);
  return DISC;
}

// PointsMaterial with a per-point size attribute (metres with size attenuation).
function sizedPointsMaterial(params) {
  const m = new THREE.PointsMaterial(params);
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSize;')
      .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;');
  };
  m.customProgramCacheKey = () => 'points-sized-v2';
  return m;
}

const CHALK_N = 120;
const CHALK_LIFE = 1.5;

export class ChalkBurst {
  constructor(scene, rng) {
    this.rng = rng || new Rng(0xC20D);
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(CHALK_N * 3);
    this.vel = new Float32Array(CHALK_N * 3);
    this.col = new Float32Array(CHALK_N * 4);
    this.size = new Float32Array(CHALK_N);
    const c = new THREE.Color(0xf6f3ea);
    for (let i = 0; i < CHALK_N; i++) { this.col[i * 4] = c.r; this.col[i * 4 + 1] = c.g; this.col[i * 4 + 2] = c.b; this.col[i * 4 + 3] = 0; }
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('color', this.colAttr);
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = sizedPointsMaterial({
      map: softDisc(), size: 1, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.material.name = 'chalk';
    this.points = new THREE.Points(g, this.material);
    this.points.name = 'chalkBurst';
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.t = CHALK_LIFE;
    if (scene) scene.add(this.points);
  }

  /** Spawn a burst at `pos` ({x, y, z}: mid-point of both palm sockets). */
  burst(pos) {
    const r = this.rng;
    for (let i = 0; i < CHALK_N; i++) {
      const a = r.range(0, Math.PI * 2);
      const sp = r.range(1.2, 2.0);
      this.pos[i * 3] = pos.x + r.range(-0.04, 0.04);
      this.pos[i * 3 + 1] = pos.y + r.range(-0.04, 0.04);
      this.pos[i * 3 + 2] = pos.z + r.range(-0.04, 0.04);
      this.vel[i * 3] = Math.cos(a) * sp;
      this.vel[i * 3 + 1] = r.range(0.8, 1.6);
      this.vel[i * 3 + 2] = Math.sin(a) * sp;
      this.size[i] = r.range(0.05, 0.12);
      this.col[i * 4 + 3] = 0.6;
    }
    this.points.geometry.getAttribute('aSize').needsUpdate = true;
    this.t = 0;
    this.points.visible = true;
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  update(dt) {
    if (this.t >= CHALK_LIFE) return;
    this.t += dt;
    if (this.t >= CHALK_LIFE) { this.points.visible = false; return; }
    const drag = Math.max(0, 1 - 2.5 * dt);
    const alpha = 0.6 * (1 - this.t / CHALK_LIFE);
    for (let i = 0; i < CHALK_N; i++) {
      const k = i * 3;
      this.vel[k] *= drag; this.vel[k + 1] = this.vel[k + 1] * drag - 0.6 * dt; this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      this.col[i * 4 + 3] = alpha;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  get active() { return this.t < CHALK_LIFE; }
}

const FLASH_N = 64;
const FLASH_LIFE = 0.07;
const BURSTS = Object.freeze({ dunk: [40, 1.2], three: [20, 0.8], winner: [64, 2.0] });

export class CameraFlashes {
  /**
   * @param {THREE.Scene|null} scene
   * @param {{x:Float32Array, y:Float32Array, z:Float32Array, count:number}} seats  occupied seats (crowd.visibleSeats)
   * @param {Rng} [rng]
   */
  constructor(scene, seats, rng) {
    this.rng = rng || new Rng(0xC20D);
    this.seats = seats;
    this.pos = new Float32Array(FLASH_N * 3);
    this.col = new Float32Array(FLASH_N * 3);
    this.life = new Float32Array(FLASH_N);
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', this.posAttr);
    g.setAttribute('color', this.colAttr);
    this.material = new THREE.PointsMaterial({
      map: softDisc(), size: 0.35, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
    });
    this.material.name = 'flashes';
    this.points = new THREE.Points(g, this.material);
    this.points.name = 'cameraFlashes';
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.remaining = 0;
    this.rate = 0;
    this.acc = 0;
    this.next = 0;
    this.alive = 0;
    if (scene) scene.add(this.points);
  }

  /** Start a burst: 'dunk' | 'three' | 'winner'. */
  burst(kind) {
    const b = BURSTS[kind];
    if (!b) return;
    this.remaining = Math.max(this.remaining, b[0]);
    this.rate = b[0] / b[1];
    this.acc = 0;
  }

  update(dt) {
    if (this.remaining > 0 && this.seats && this.seats.count > 0) {
      this.acc += this.rate * dt;
      while (this.acc >= 1 && this.remaining > 0) {
        this.acc -= 1;
        this.remaining--;
        const s = this.rng.int(this.seats.count);
        const i = this.next;
        this.next = (this.next + 1) % FLASH_N;
        this.pos[i * 3] = this.seats.x[s];
        this.pos[i * 3 + 1] = this.seats.y[s] + 1.1;
        this.pos[i * 3 + 2] = this.seats.z[s];
        this.life[i] = FLASH_LIFE;
      }
      this.posAttr.needsUpdate = true;
    }
    let alive = 0;
    for (let i = 0; i < FLASH_N; i++) {
      if (this.life[i] > 0) {
        this.life[i] = Math.max(0, this.life[i] - dt);
        const k = this.life[i] / FLASH_LIFE;
        const v = 3.0 * k;
        this.col[i * 3] = v; this.col[i * 3 + 1] = v; this.col[i * 3 + 2] = v * 0.95;
        alive++;
      } else if (this.col[i * 3] !== 0) {
        this.col[i * 3] = 0; this.col[i * 3 + 1] = 0; this.col[i * 3 + 2] = 0;
        alive++;
      }
    }
    if (alive > 0) this.colAttr.needsUpdate = true;
    this.alive = alive;
    this.points.visible = alive > 0 || this.remaining > 0;
  }
}

export class ControlRing {
  constructor(scene) {
    this.material = new THREE.MeshBasicMaterial({ color: 0xffb81c, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false });
    this.material.name = 'controlRing';
    this.mesh = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.50, 48).rotateX(-Math.PI / 2), this.material);
    this.mesh.name = 'controlRing';
    this.mesh.position.y = 0.006;
    this.mesh.renderOrder = -1;
    this.baseScale = 1;
    this.pulseT = 1;
    this.mesh.visible = false;
    if (scene) scene.add(this.mesh);
  }

  /** Team UI colour (css string or hex). */
  setColour(c) { this.material.color.set(c); }

  /** Pulse 1.25 → 1.0 over 0.25 s (control change). */
  pulse() { this.pulseT = 0; }

  /** Show / hide (hidden in intro and replay). */
  setVisible(v) { this.mesh.visible = !!v; }

  /** Place under the pelvis of the controlled player; radius × shoulderJoints / 0.46. */
  update(dt, x, z, shoulderJoints) {
    if (this.pulseT < 0.25) this.pulseT = Math.min(0.25, this.pulseT + dt);
    const p = 1.25 - 0.25 * (this.pulseT / 0.25);
    const s = (shoulderJoints || 0.46) / 0.46 * p;
    this.mesh.position.x = x;
    this.mesh.position.z = z;
    this.mesh.scale.set(s, 1, s);
  }
}

/**
 * Bundle used by the router (`fx.chalkBurst(pos)`) and the frame loop.
 * @param {THREE.Scene} scene
 * @param {object} quality
 * @param {{crowd?:object, rng?:Rng}} [opts]  crowd → camera-flash seats (high only)
 */
export function createFx(scene, quality, opts) {
  const o = opts || {};
  const rng = o.rng || new Rng(0xC20D);
  const tier = (quality && (quality.loadTier || quality.tier)) || 'low';
  const chalk = new ChalkBurst(scene, rng);
  const ring = new ControlRing(scene);
  let flashes = null;
  if (o.crowd && TIERS[tier].crowd.flashes) flashes = new CameraFlashes(scene, o.crowd.visibleSeats, rng);
  let flashesOn = !!flashes && TIERS[(quality && quality.tier) || tier].crowd.flashes;
  return {
    chalk, ring, flashes,
    chalkBurst(pos) { chalk.burst(pos); },
    /** Camera-flash burst ('dunk' | 'three' | 'winner'); no-op below high. */
    flash(kind) { if (flashes && flashesOn) flashes.burst(kind); },
    setTier(t2) { flashesOn = !!flashes && !!(TIERS[t2] && TIERS[t2].crowd.flashes); if (flashes && !flashesOn) flashes.points.visible = false; },
    update(dt) { chalk.update(dt); if (flashes && flashesOn) flashes.update(dt); },
  };
}
