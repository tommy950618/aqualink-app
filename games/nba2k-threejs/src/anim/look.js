/**
 * look.js — head / neck look-at with spine help, eye (iris UV) offset and idle saccades (spec §4.6 "Look-at",
 * [ANIM §2.6.3]).
 *
 * Exports
 *   LookAt (class), LOOK_LIMITS (frozen numbers), eyeOffset(look, out) (convenience: copies the smoothed iris offset
 *   into a THREE.Vector2-like {x, y} or an array).
 *
 * Model (all in the character frame, after the layered pose has been FK'd into a Skel):
 *   origin = the `eyeC` socket; the target direction is expressed in the spine_03 frame →
 *   yaw = atan2(dx, dz) (+ = to the character's left), pitch = −atan2(dy, hypot(dx, dz)) (+ = down, like N pitch);
 *   limits yaw ±80° (beyond 70° the excess goes to spine_03 yaw, up to 12°, when the base layer is locomotion / idle),
 *   pitch −40° (up) … +30° (down); split neck 40 % / head 60 % as additive rotations (pre-multiplied in the parent
 *   frame) scaled by the look weight; critically-damped springs ω = 12 rad/s with ≤ 400°/s.
 *   Iris: the residual angles the head did not cover (target vs the head's forward axis after the look) give
 *   eyeOffset.x = clamp(remYaw/35°, −1, 1)·0.10, eyeOffset.y = clamp(remPitch/30°, −1, 1)·0.07 (|·| ≤ (0.12, 0.09)),
 *   spring ω = 30; idle saccades every 0.6–2.2 s (cosmetic RNG, advanced only in the fixed step) add ±0.02 UV for
 *   0.15 s.
 * Springs run on the render frame time (cosmetic); RNG draws happen in step() only (H8). Zero allocation (H10).
 */
import { BONE, qmul, qconj, qrotate } from './rig.js';
import { axisAngle } from './ik.js';

const DEG = Math.PI / 180;

/** Look-at limits and dynamics ([ANIM §2.6.3]). */
export const LOOK_LIMITS = Object.freeze({
  yaw: 80 * DEG, yawSpineFrom: 70 * DEG, spineMax: 12 * DEG, pitchUp: -40 * DEG, pitchDown: 30 * DEG,
  omega: 12, maxSpeed: 400 * DEG, eyeOmega: 30, eyeX: 0.10, eyeY: 0.07, eyeYawRef: 35 * DEG, eyePitchRef: 30 * DEG,
  eyeClampX: 0.12, eyeClampY: 0.09, saccade: 0.02, saccadeDur: 0.15,
});
const LL = LOOK_LIMITS;

const NECK = BONE.neck_01, HEAD = BONE.head, SP3 = BONE.spine_03;
const _d = new Float64Array(3), _e = new Float64Array(3), _q = new Float64Array(4), _q2 = new Float64Array(4);

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

/** Critically damped spring step for one angle (x, v) toward target; returns [x, v] in the 2-slot array s at i. */
function spring(s, i, target, omega, dt, vmax) {
  const x = s[i], v = s[i + 1];
  const a = omega * omega * (target - x) - 2 * omega * v;
  let nv = v + a * dt;
  if (vmax > 0) nv = clamp(nv, -vmax, vmax);
  s[i] = x + nv * dt; s[i + 1] = nv;
}

/** Look-at state of one player (module header). */
export class LookAt {
  constructor() {
    this.st = new Float64Array(6);          // yaw, vYaw, pitch, vPitch, spineYaw, vSpine (rad, rad/s)
    this.eye = new Float64Array(4);         // x, vx, y, vy (UV)
    this.out = { x: 0, y: 0 };              // smoothed iris offset incl. saccade
    this.sacT = 1.0; this.sacLeft = 0; this.sacX = 0; this.sacY = 0;
    this.remYaw = 0; this.remPitch = 0;
    this.tYaw = 0; this.tPitch = 0;         // last raw target angles (diagnostics / tests)
  }

  /** Fixed step: schedules idle saccades with the cosmetic RNG (only here, H8). */
  step(dt, rng, idle) {
    if (this.sacLeft > 0) this.sacLeft -= dt;
    this.sacT -= dt;
    if (this.sacT <= 0) {
      const r = rng ? rng.next() : 0.5;
      this.sacT = 0.6 + 1.6 * r;
      if (idle) {
        const a = rng ? rng.next() : 0.5, b = rng ? rng.next() : 0.5;
        this.sacX = (2 * a - 1) * LL.saccade; this.sacY = (2 * b - 1) * LL.saccade; this.sacLeft = LL.saccadeDur;
      }
    }
  }

  /**
   * Render update + apply: target (tx, ty, tz) in the character frame (ignored when weight ≤ 0: the head returns to the
   * clip pose), weight 0..1, allowSpine (base layer is locomotion / idle). Modifies sk.L of spine_03 / neck / head and
   * re-runs FK of the spine_03 sub-tree. dt = render frame time (s).
   */
  update(sk, dt, tx, ty, tz, weight, allowSpine) {
    const h = dt > 0.05 ? 0.05 : dt;
    let yawT = 0, pitchT = 0, spineT = 0;
    if (weight > 0) {
      // eye origin and target direction in the spine_03 frame
      sk.sock(16, _e, 0);                          // SOCK.eyeC
      _d[0] = tx - _e[0]; _d[1] = ty - _e[1]; _d[2] = tz - _e[2];
      qconj(sk.W, SP3 * 4, _q, 0);
      qrotate(_q, 0, _d, 0, _d, 0);
      let yaw = Math.atan2(_d[0], _d[2]);
      let pitch = -Math.atan2(_d[1], Math.hypot(_d[0], _d[2]));
      this.tYaw = yaw; this.tPitch = pitch;
      if (allowSpine && Math.abs(yaw) > LL.yawSpineFrom) {
        spineT = clamp((Math.abs(yaw) - LL.yawSpineFrom) * Math.sign(yaw), -LL.spineMax, LL.spineMax);
        yaw -= spineT;
      }
      yaw = clamp(yaw, -LL.yaw, LL.yaw);
      pitch = clamp(pitch, LL.pitchUp, LL.pitchDown);
      yawT = yaw * weight; pitchT = pitch * weight; spineT *= weight;
    }
    const s = this.st;
    spring(s, 0, yawT, LL.omega, h, LL.maxSpeed);
    spring(s, 2, pitchT, LL.omega, h, LL.maxSpeed);
    spring(s, 4, spineT, LL.omega, h, LL.maxSpeed);
    // apply: spine_03 yaw, neck 40 %, head 60 % (pre-multiplied in the parent frame)
    const L = sk.L;
    if (Math.abs(s[4]) > 1e-6) { axisAngle(0, 1, 0, s[4], _q, 0); qmul(_q, 0, L, SP3 * 4, L, SP3 * 4); }
    this.rot(L, NECK, 0.4 * s[0], 0.4 * s[2]);
    this.rot(L, HEAD, 0.6 * s[0], 0.6 * s[2]);
    sk.fkSub(SP3);
    // residual angles for the iris: target direction in the head frame
    let ex = 0, ey = 0;
    if (weight > 0) {
      sk.sock(16, _e, 0);
      _d[0] = tx - _e[0]; _d[1] = ty - _e[1]; _d[2] = tz - _e[2];
      qconj(sk.W, HEAD * 4, _q, 0);
      qrotate(_q, 0, _d, 0, _d, 0);
      this.remYaw = Math.atan2(_d[0], _d[2]);
      this.remPitch = -Math.atan2(_d[1], Math.hypot(_d[0], _d[2]));
      ex = clamp(this.remYaw / LL.eyeYawRef, -1, 1) * LL.eyeX * weight;
      ey = clamp(this.remPitch / LL.eyePitchRef, -1, 1) * LL.eyeY * weight;
    } else { this.remYaw = 0; this.remPitch = 0; }
    const e = this.eye;
    spring(e, 0, ex, LL.eyeOmega, h, 0);
    spring(e, 2, ey, LL.eyeOmega, h, 0);
    const sx = this.sacLeft > 0 ? this.sacX : 0, sy = this.sacLeft > 0 ? this.sacY : 0;
    this.out.x = clamp(e[0] + sx, -LL.eyeClampX, LL.eyeClampX);
    this.out.y = clamp(e[2] + sy, -LL.eyeClampY, LL.eyeClampY);
  }

  /** L[b] ← Ry(yaw)·Rx(pitch)·L[b]. */
  rot(L, b, yaw, pitch) {
    if (Math.abs(yaw) < 1e-7 && Math.abs(pitch) < 1e-7) return;
    axisAngle(0, 1, 0, yaw, _q, 0);
    axisAngle(1, 0, 0, pitch, _q2, 0);
    qmul(_q, 0, _q2, 0, _q, 0);
    qmul(_q, 0, L, b * 4, L, b * 4);
  }

  /** Snaps the springs to zero (teleports / resets). */
  reset() { this.st.fill(0); this.eye.fill(0); this.out.x = 0; this.out.y = 0; }
}

/** Copies the smoothed iris offset of `look` into out ({x, y} object such as THREE.Vector2, or an array). */
export function eyeOffset(look, out) {
  if (Array.isArray(out) || ArrayBuffer.isView(out)) { out[0] = look.out.x; out[1] = look.out.y; }
  else { out.x = look.out.x; out.y = look.out.y; }
  return out;
}
