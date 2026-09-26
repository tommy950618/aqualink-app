// Broadcast camera (spec section 9): fixed yaw, elevated behind the offence, framing chosen by
// aspect (landscape / portrait), exponential damping in frame time (position/look rate 5, fov rate 3)
// and a slight zoom when the ball is in the paint. No allocations per frame.
import * as THREE from '../vendor/three.module.js';
import { RIM, COURT } from './constants.js';
import { clamp } from './math.js';

const RATE_POS = 5;
const RATE_FOV = 3;
const NEAR = 0.5, FAR = 120;
const LANDSCAPE = { fov: 44, kx: 0.35, y: 8.0, z0: 4.5, kz: 0.20, lookY: 1.0, lookZ: -9.0 };
const PORTRAIT = { fov: 70, kx: 0.80, y: 11.0, z0: 8.0, kz: 0, lookY: 1.0, lookZ: -9.0 };
const PAINT_R = 4.5;
const PAINT_ZOOM = 4;
const BALL_Z_MIN = -14.3, BALL_Z_MAX = 0;

const T = { px: 0, py: 0, pz: 0, lx: 0, ly: 0, lz: 0, fov: 44 };

function ballOf(world) {
  if (!world) return null;
  if (world.ball && world.ball.pos) return world.ball.pos;
  return world.pos ? world.pos : null;
}

export class BroadcastCamera {
  constructor(aspect) {
    const a = aspect > 0 ? aspect : 16 / 9;
    this.portrait = a < 1;
    this.camera = new THREE.PerspectiveCamera(this.portrait ? PORTRAIT.fov : LANDSCAPE.fov, a, NEAR, FAR);
    this.camera.name = 'broadcast';
    this.pos = new THREE.Vector3(0, LANDSCAPE.y, LANDSCAPE.z0 + LANDSCAPE.kz * 9);
    this.look = new THREE.Vector3(0, LANDSCAPE.lookY, LANDSCAPE.lookZ);
    this.fov = this.camera.fov;
    this.needsSnap = true;
    this.apply();
  }

  // Called on resize; portrait is decided by aspect < 1 only.
  setAspect(aspect) {
    if (!(aspect > 0)) return;
    this.portrait = aspect < 1;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  // Section 9 targets for the current ball position, written into T.
  computeTarget(world) {
    const bp = ballOf(world);
    const bx = bp ? clamp(bp.x, -COURT.HALF_W, COURT.HALF_W) : 0;
    const bz = bp ? clamp(bp.z, BALL_Z_MIN, BALL_Z_MAX) : -9;
    const f = this.portrait ? PORTRAIT : LANDSCAPE;
    T.px = f.kx * bx;
    T.py = f.y;
    T.pz = f.z0 + f.kz * (bz + 9);
    T.lx = f.kx * bx;
    T.ly = f.lookY;
    T.lz = f.lookZ;
    T.fov = f.fov;
    const rx = bx - RIM.x, rz = bz - RIM.z;
    if (rx * rx + rz * rz < PAINT_R * PAINT_R) T.fov -= PAINT_ZOOM;
    return T;
  }

  // Damped follow; the first update after construction (or after snap was requested) snaps.
  update(dt, world) {
    if (this.needsSnap) { this.snapTo(world); return; }
    this.computeTarget(world);
    const k = dt > 0 ? dt : 0;
    // x += (target - x) * (1 - exp(-rate dt)); one factor per rate, kept in locals.
    const kp = 1 - Math.exp(-RATE_POS * k);
    const kf = 1 - Math.exp(-RATE_FOV * k);
    const p = this.pos, l = this.look;
    p.x += (T.px - p.x) * kp; p.y += (T.py - p.y) * kp; p.z += (T.pz - p.z) * kp;
    l.x += (T.lx - l.x) * kp; l.y += (T.ly - l.y) * kp; l.z += (T.lz - l.z) * kp;
    this.fov += (T.fov - this.fov) * kf;
    this.apply();
  }

  // Jump straight to the target framing (MENU -> CHECK, teleports).
  snapTo(world) {
    this.computeTarget(world);
    this.pos.set(T.px, T.py, T.pz);
    this.look.set(T.lx, T.ly, T.lz);
    this.fov = T.fov;
    this.needsSnap = false;
    this.apply();
  }

  // Ask for a snap on the next update (e.g. when the game enters CHECK from MENU).
  requestSnap() { this.needsSnap = true; }

  // The framing never yaws or rolls (camPos.x === lookAt.x by construction), so the orientation is a
  // pure pitch about X toward the look point; setting it directly avoids Object3D.lookAt's work.
  apply() {
    const c = this.camera;
    c.position.copy(this.pos);
    const dy = this.pos.y - this.look.y, dz = this.pos.z - this.look.z;
    const pitch = -Math.atan2(dy, dz);
    if (c.rotation.x !== pitch || c.rotation.y !== 0 || c.rotation.z !== 0) c.rotation.set(pitch, 0, 0);
    if (Math.abs(c.fov - this.fov) > 1e-3) {
      c.fov = this.fov;
      c.updateProjectionMatrix();
    }
  }
}
