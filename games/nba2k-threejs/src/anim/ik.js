/**
 * ik.js — character-frame skeleton state, forward kinematics and analytic two-bone IK (spec §4.6, [ANIM §2.6.4,
 * §2.6.5]).
 *
 * Exports
 *   Skel (class: local / world quaternions and positions of the 53 bones in the character frame, FK helpers, socket
 *   positions), DESC (descendant lists per bone), twoBoneIK(sk, a, b, c, eff, target, pole, weight, poleW, hinge),
 *   footLock(sk, side, tgt) (leg IK + flat / toe foot orientation), footReach(sk, side, tgt, out) (reach data for auto-release), ankleTarget(sk, side, tgt, pitch, out),
 *   toePitchFor(sk, side, tgt, reach), footDropFor(sk, side, tgt, hx, hy, hz, R) (pelvis drop for reachability), handOnBall(sk, side, ball, weight), handToPoint(sk, side, sockIdx, point, pole,
 *   weight, poleW), FootTarget (plain record class), LEG_IK / ARM_IK (bone triples per side: 0 = right, 1 = left),
 *   axisAngle, quatFromTo, Ry, RyRx (allocation-free quaternion builders on flat arrays).
 *
 * Frames. The "character frame" is the player's Group space: Root at the origin, +x = the character's left, +y up,
 * +z forward (spec §4.1). Bind world rotations are identity, so a bone's local axes are the character axes at bind.
 * Skel.L / Skel.T hold the bone-local rotation / translation (what three.js bones receive), Skel.W / Skel.P the
 * character-frame rotation / position after FK. Everything is Float64Array, allocated once; no function here
 * allocates (H10).
 *
 * Two-bone solver (chain A → B → effector E, E rigidly attached to C = child of B):
 *   1. bend at B about the true plane normal n = (A − B) × (E − B) (exact: a rotation about n changes the interior
 *      angle one-to-one; the anatomical hinge is used only when the chain is straight) from the current interior
 *      angle to acos((lab² + lcb² − lat²)/(2·lab·lcb)), lat = clamp(|T − A|, |lab − lcb|, 0.999·(lab + lcb)) — the
 *      interior angle is kept ≥ 30° (= the 150° knee / elbow flexion limit of [ANIM §1.7]);
 *   2. aim at A with the shortest-arc rotation taking (E′ − A) to (T − A);
 *   3. optional pole twist about the A→T axis that puts B in the half-plane of the pole hint (exact; E stays on the
 *      axis), scaled by poleW;
 *   4. world → local (L_A = W_parent⁻¹·W_A, L_B = W_A⁻¹·W_B), nlerp from the incoming locals by `weight`, FK of the
 *      A sub-tree. Reachable targets end within numerical precision (unit test: 10,000 targets ≤ 1 mm);
 *      unreachable ones straighten the chain toward the target.
 * Knee pole = hip + Ry(foot yaw)·(0, −0.5, 0.6)·sLeg (knees track the toes); elbow poles are passed by the caller.
 */
import { BONE_COUNT, BONE_PARENT, BONE, BONE_NAMES, qmul, qconj, qrotate, qnlerp } from './rig.js';

// ---------------------------------------------------------------------------------------------------------------
// Hierarchy helpers
// ---------------------------------------------------------------------------------------------------------------

/** DESC[b] = Int8Array of every descendant of bone b in parent-first order (the header order). */
export const DESC = (() => {
  const out = [];
  for (let b = 0; b < BONE_COUNT; b++) {
    const list = [];
    for (let i = b + 1; i < BONE_COUNT; i++) {
      for (let p = BONE_PARENT[i]; p >= 0; p = BONE_PARENT[p]) if (p === b) { list.push(i); break; }
    }
    out.push(Int8Array.from(list));
  }
  return Object.freeze(out);
})();

/** Leg chains per side (0 = right, 1 = left): [thigh, calf, foot, ball]. */
export const LEG_IK = Object.freeze([
  Int8Array.from([BONE.thigh_r, BONE.calf_r, BONE.foot_r, BONE.ball_r]),
  Int8Array.from([BONE.thigh_l, BONE.calf_l, BONE.foot_l, BONE.ball_l]),
]);
/** Arm chains per side (0 = right, 1 = left): [clavicle, upperarm, lowerarm, hand]. */
export const ARM_IK = Object.freeze([
  Int8Array.from([BONE.clavicle_r, BONE.upperarm_r, BONE.lowerarm_r, BONE.hand_r]),
  Int8Array.from([BONE.clavicle_l, BONE.upperarm_l, BONE.lowerarm_l, BONE.hand_l]),
]);

// ---------------------------------------------------------------------------------------------------------------
// Quaternion builders (flat arrays, [x, y, z, w])
// ---------------------------------------------------------------------------------------------------------------

/** out[o..] = rotation of `ang` radians about the unit axis (ax, ay, az). */
export function axisAngle(ax, ay, az, ang, out, o) {
  const h = 0.5 * ang, s = Math.sin(h);
  out[o] = ax * s; out[o + 1] = ay * s; out[o + 2] = az * s; out[o + 3] = Math.cos(h);
  return out;
}

/** out[o..] = shortest-arc rotation taking unit vector u to unit vector v (antiparallel: 180° about a ⟂ axis). */
export function quatFromTo(ux, uy, uz, vx, vy, vz, out, o) {
  const d = ux * vx + uy * vy + uz * vz;
  if (d < -0.999999) {
    // any axis perpendicular to u
    let px = 0, py = -uz, pz = uy;
    if (px * px + py * py + pz * pz < 1e-8) { px = uz; py = 0; pz = -ux; }
    const l = Math.sqrt(px * px + py * py + pz * pz);
    out[o] = px / l; out[o + 1] = py / l; out[o + 2] = pz / l; out[o + 3] = 0;
    return out;
  }
  // q = normalize(1 + d, u × v): half-angle construction, exact for unit inputs
  let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, w = 1 + d;
  const l = Math.sqrt(x * x + y * y + z * z + w * w);
  out[o] = x / l; out[o + 1] = y / l; out[o + 2] = z / l; out[o + 3] = w / l;
  return out;
}

/** out[o..] = Ry(yaw) (radians). */
export function Ry(yaw, out, o) {
  const h = 0.5 * yaw;
  out[o] = 0; out[o + 1] = Math.sin(h); out[o + 2] = 0; out[o + 3] = Math.cos(h);
  return out;
}

/** out[o..] = Ry(yaw)·Rx(pitch) (radians): a foot turned by yaw and pitched toes-down by pitch. */
export function RyRx(yaw, pitch, out, o) {
  const cy = Math.cos(0.5 * yaw), sy = Math.sin(0.5 * yaw), cx = Math.cos(0.5 * pitch), sx = Math.sin(0.5 * pitch);
  // (0, sy, 0, cy)·(sx, 0, 0, cx)
  out[o] = cy * sx; out[o + 1] = sy * cx; out[o + 2] = -sy * sx; out[o + 3] = cy * cx;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Skeleton state
// ---------------------------------------------------------------------------------------------------------------

/** Per-animator skeleton state in the character frame (see the module header). */
export class Skel {
  /** @param {object} rig buildRig() result */
  constructor(rig) {
    this.rig = rig;
    this.L = new Float64Array(BONE_COUNT * 4);
    this.T = new Float64Array(BONE_COUNT * 3);
    this.W = new Float64Array(BONE_COUNT * 4);
    this.P = new Float64Array(BONE_COUNT * 3);
    this.reset();
  }

  /** Bind pose: identity locals, rest translations; FK. */
  reset() {
    const L = this.L, T = this.T, rp = this.rig.restPos;
    for (let b = 0; b < BONE_COUNT; b++) {
      L[b * 4] = 0; L[b * 4 + 1] = 0; L[b * 4 + 2] = 0; L[b * 4 + 3] = 1;
      T[b * 3] = rp[b * 3]; T[b * 3 + 1] = rp[b * 3 + 1]; T[b * 3 + 2] = rp[b * 3 + 2];
    }
    this.fkAll();
  }

  /** FK of one bone from its (already up to date) parent. */
  fkBone(b) {
    const p = BONE_PARENT[b], W = this.W, P = this.P, T = this.T;
    if (p < 0) {
      W[b * 4] = this.L[b * 4]; W[b * 4 + 1] = this.L[b * 4 + 1]; W[b * 4 + 2] = this.L[b * 4 + 2]; W[b * 4 + 3] = this.L[b * 4 + 3];
      P[b * 3] = T[b * 3]; P[b * 3 + 1] = T[b * 3 + 1]; P[b * 3 + 2] = T[b * 3 + 2];
      return;
    }
    qmul(W, p * 4, this.L, b * 4, W, b * 4);
    qrotate(W, p * 4, T, b * 3, _v, 0);
    P[b * 3] = P[p * 3] + _v[0]; P[b * 3 + 1] = P[p * 3 + 1] + _v[1]; P[b * 3 + 2] = P[p * 3 + 2] + _v[2];
  }

  /** FK of the whole skeleton (header order is parents-first). */
  fkAll() { for (let b = 0; b < BONE_COUNT; b++) this.fkBone(b); }

  /** FK of bone b and its whole sub-tree. */
  fkSub(b) {
    this.fkBone(b);
    const d = DESC[b];
    for (let i = 0; i < d.length; i++) this.fkBone(d[i]);
  }

  /** Character-frame position of bone b's point `off` (offset in the bone frame, Float64Array/Array at offO). */
  point(b, off, offO, out, o) {
    qrotate(this.W, b * 4, off, offO, _v, 0);
    out[o] = this.P[b * 3] + _v[0]; out[o + 1] = this.P[b * 3 + 1] + _v[1]; out[o + 2] = this.P[b * 3 + 2] + _v[2];
    return out;
  }

  /** Character-frame position of socket sockIdx (SOCK.*, bone-attached sockets only) into out[o..o+2]. */
  sock(sockIdx, out, o = 0) {
    const s = this.rig.sock, b = s[sockIdx * 4];
    _off[0] = s[sockIdx * 4 + 1]; _off[1] = s[sockIdx * 4 + 2]; _off[2] = s[sockIdx * 4 + 3];
    return this.point(b, _off, 0, out, o);
  }

  /** Copies all four arrays from another Skel of the same rig. */
  copy(src) { this.L.set(src.L); this.T.set(src.T); this.W.set(src.W); this.P.set(src.P); return this; }
}

const _v = new Float64Array(3);
const _off = new Float64Array(3);

// ---------------------------------------------------------------------------------------------------------------
// Two-bone IK
// ---------------------------------------------------------------------------------------------------------------

const MIN_INTERIOR = 30 * Math.PI / 180;     // ≥ 30° interior = ≤ 150° knee / elbow flexion ([ANIM §1.7])
const _A = new Float64Array(3), _B = new Float64Array(3), _E = new Float64Array(3), _t = new Float64Array(3);
const _qB = new Float64Array(4), _qA = new Float64Array(4), _qT = new Float64Array(4), _qW = new Float64Array(4);
const _la = new Float64Array(4), _lb = new Float64Array(4), _wa = new Float64Array(4), _wb = new Float64Array(4);
const _h = new Float64Array(3);
const ZERO3 = new Float64Array(3);

/**
 * Analytic two-bone IK in the character frame (module header). a, b, c = bone indices of the chain (b's parent is a,
 * c's parent is b); eff = effector offset in c's bone frame (Float64Array(3), zero = c's head); target = char-frame
 * point (array-like, 3); pole = char-frame pole hint or null (no twist: the current bend plane is kept); weight 0..1;
 * poleW 0..1 scales the pole twist; hinge = b-local axis used only when the chain is exactly straight, oriented so a
 * positive rotation opens (extends) the joint. Returns the remaining effector → target distance (m).
 */
export function twoBoneIK(sk, a, b, c, eff, target, pole, weight = 1, poleW = 1, hinge = null) {
  if (weight <= 0) return -1;
  const P = sk.P, W = sk.W, L = sk.L;
  _A[0] = P[a * 3]; _A[1] = P[a * 3 + 1]; _A[2] = P[a * 3 + 2];
  _B[0] = P[b * 3]; _B[1] = P[b * 3 + 1]; _B[2] = P[b * 3 + 2];
  sk.point(c, eff || ZERO3, 0, _E, 0);
  const tx = target[0], ty = target[1], tz = target[2];
  // segment lengths (rigid)
  const bax = _A[0] - _B[0], bay = _A[1] - _B[1], baz = _A[2] - _B[2];
  const bcx = _E[0] - _B[0], bcy = _E[1] - _B[1], bcz = _E[2] - _B[2];
  const lab = Math.sqrt(bax * bax + bay * bay + baz * baz), lcb = Math.sqrt(bcx * bcx + bcy * bcy + bcz * bcz);
  if (lab < 1e-6 || lcb < 1e-6) return -1;
  let atx = tx - _A[0], aty = ty - _A[1], atz = tz - _A[2];
  let lat = Math.sqrt(atx * atx + aty * aty + atz * atz);
  const lo = Math.max(0.01, Math.abs(lab - lcb) + 1e-6), hi = 0.999 * (lab + lcb);
  if (lat < 1e-6) { atx = _E[0] - _A[0]; aty = _E[1] - _A[1]; atz = _E[2] - _A[2]; lat = Math.sqrt(atx * atx + aty * aty + atz * atz) || 1; }
  const latC = lat < lo ? lo : lat > hi ? hi : lat;

  // ---- 1. bend at B ----
  const cosCur = (bax * bcx + bay * bcy + baz * bcz) / (lab * lcb);
  const cur = Math.acos(cosCur < -1 ? -1 : cosCur > 1 ? 1 : cosCur);
  let cosDes = (lab * lab + lcb * lcb - latC * latC) / (2 * lab * lcb);
  cosDes = cosDes < -1 ? -1 : cosDes > 1 ? 1 : cosDes;
  let des = Math.acos(cosDes);
  if (des < MIN_INTERIOR) des = MIN_INTERIOR;
  // plane normal (positive rotation about it opens the joint: BA → BC is the positive sense)
  let nx = bay * bcz - baz * bcy, ny = baz * bcx - bax * bcz, nz = bax * bcy - bay * bcx;
  let nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (nl < 1e-7 * lab * lcb) {
    // straight chain: bend toward the pole (B ends on the pole side of A→T), else about the anatomical hinge
    let done = false;
    if (pole) {
      const ux = atx / lat, uy = aty / lat, uz = atz / lat;
      let px = pole[0] - _A[0], py = pole[1] - _A[1], pz = pole[2] - _A[2];
      const d = px * ux + py * uy + pz * uz;
      px -= ux * d; py -= uy * d; pz -= uz * d;
      // n = u × pperp (derived: B displaced toward the pole gives (A − B) × (E − B) ∥ u × pperp)
      nx = uy * pz - uz * py; ny = uz * px - ux * pz; nz = ux * py - uy * px;
      nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      done = nl > 1e-9;
    }
    if (!done) {
      if (hinge) qrotate(W, b * 4, hinge, 0, _h, 0); else { _h[0] = 1; _h[1] = 0; _h[2] = 0; }
      nx = _h[0]; ny = _h[1]; nz = _h[2]; nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    }
  }
  nx /= nl; ny /= nl; nz /= nl;
  axisAngle(nx, ny, nz, des - cur, _qB, 0);
  // E' = B + qB·(E − B)
  _t[0] = bcx; _t[1] = bcy; _t[2] = bcz;
  qrotate(_qB, 0, _t, 0, _t, 0);
  let ex = _B[0] + _t[0] - _A[0], ey = _B[1] + _t[1] - _A[1], ez = _B[2] + _t[2] - _A[2];
  const el = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1;
  ex /= el; ey /= el; ez /= el;

  // ---- 2. aim at A ----
  const ux = atx / lat, uy = aty / lat, uz = atz / lat;
  quatFromTo(ex, ey, ez, ux, uy, uz, _qA, 0);

  // ---- 3. pole twist about A→T ----
  if (pole && poleW > 0) {
    _t[0] = -bax; _t[1] = -bay; _t[2] = -baz;            // B − A
    qrotate(_qA, 0, _t, 0, _t, 0);
    let d = _t[0] * ux + _t[1] * uy + _t[2] * uz;
    const bx = _t[0] - ux * d, by = _t[1] - uy * d, bz = _t[2] - uz * d;
    let px = pole[0] - _A[0], py = pole[1] - _A[1], pz = pole[2] - _A[2];
    d = px * ux + py * uy + pz * uz;
    px -= ux * d; py -= uy * d; pz -= uz * d;
    if (bx * bx + by * by + bz * bz > 1e-10 && px * px + py * py + pz * pz > 1e-10) {
      // signed angle from b⊥ to p⊥ about u
      const cx = by * pz - bz * py, cy = bz * px - bx * pz, cz = bx * py - by * px;
      const ang = Math.atan2(cx * ux + cy * uy + cz * uz, bx * px + by * py + bz * pz) * (poleW > 1 ? 1 : poleW);
      axisAngle(ux, uy, uz, ang, _qT, 0);
      qmul(_qT, 0, _qA, 0, _qA, 0);
    }
  }

  // ---- 4. world → local, weight, FK ----
  const pa = BONE_PARENT[a];
  _la[0] = L[a * 4]; _la[1] = L[a * 4 + 1]; _la[2] = L[a * 4 + 2]; _la[3] = L[a * 4 + 3];
  _lb[0] = L[b * 4]; _lb[1] = L[b * 4 + 1]; _lb[2] = L[b * 4 + 2]; _lb[3] = L[b * 4 + 3];
  qmul(_qA, 0, W, a * 4, _wa, 0);                        // W_A' = QA·W_A
  qmul(_qB, 0, W, b * 4, _wb, 0);                        // QB·W_B
  qmul(_qA, 0, _wb, 0, _wb, 0);                          // W_B' = QA·QB·W_B
  if (pa >= 0) { qconj(W, pa * 4, _qW, 0); qmul(_qW, 0, _wa, 0, L, a * 4); } else { L[a * 4] = _wa[0]; L[a * 4 + 1] = _wa[1]; L[a * 4 + 2] = _wa[2]; L[a * 4 + 3] = _wa[3]; }
  qconj(_wa, 0, _qW, 0); qmul(_qW, 0, _wb, 0, L, b * 4);
  if (weight < 1) {
    qnlerp(_la, 0, L, a * 4, weight, L, a * 4);
    qnlerp(_lb, 0, L, b * 4, weight, L, b * 4);
  }
  sk.fkSub(a);
  sk.point(c, eff || ZERO3, 0, _E, 0);
  const rx = _E[0] - tx, ry = _E[1] - ty, rz = _E[2] - tz;
  return Math.sqrt(rx * rx + ry * ry + rz * rz);
}

// ---------------------------------------------------------------------------------------------------------------
// Feet
// ---------------------------------------------------------------------------------------------------------------

/** A foot IK request (char frame). mode 0 = flat (x, y, z = ankle target), 1 = toe (x, y, z = ball-joint target). */
export class FootTarget {
  constructor() {
    this.x = 0; this.y = 0; this.z = 0;      // target point (char frame)
    this.yaw = 0;                            // foot yaw (rad, char frame)
    this.pitch = 0;                          // plantar flexion (rad, toes down +)
    this.mode = 0;                           // 0 flat, 1 toe
    this.w = 0;                              // IK weight
    this.toe = 0;                            // toe extension to apply in toe mode (rad), keeps the toes flat
  }
}

const KNEE_HINGE = Float64Array.from([-1, 0, 0]);    // calf: Rx(+knee) flexes → −x opens
const _ft = new Float64Array(3), _pole = new Float64Array(3), _wf = new Float64Array(4), _ball = new Float64Array(3);
const _q4 = new Float64Array(4);

/** Ankle target (char frame) for a foot request at plantar flexion `pitch`: flat = the target itself, toe = ball target − W_f·ballOffset. */
export function ankleTarget(sk, side, tgt, pitch, out) { return ankleTargetOf(sk, side, tgt, pitch, out); }
function ankleTargetOf(sk, side, tgt, pitch, out) {
  if (tgt.mode === 1) {
    const ballB = LEG_IK[side][3], rp = sk.rig.restPos;
    _ball[0] = rp[ballB * 3]; _ball[1] = rp[ballB * 3 + 1]; _ball[2] = rp[ballB * 3 + 2];
    RyRx(tgt.yaw, pitch, _q4, 0);
    qrotate(_q4, 0, _ball, 0, _ball, 0);
    out[0] = tgt.x - _ball[0]; out[1] = tgt.y - _ball[1]; out[2] = tgt.z - _ball[2];
  } else { out[0] = tgt.x; out[1] = tgt.y; out[2] = tgt.z; }
  return out;
}

/**
 * Reach data of a foot request for the auto-release rule of [ANIM §2.6.5] and the Animator's pelvis drop; writes
 * [hip → ankle-target distance, horizontal hip → lock-point distance, ankle-target y, horizontal hip → ankle-target
 * distance] into out (array of 4).
 */
export function footReach(sk, side, tgt, out) {
  const th = LEG_IK[side][0];
  ankleTargetOf(sk, side, tgt, tgt.pitch, _ft);
  const dx = _ft[0] - sk.P[th * 3], dy = _ft[1] - sk.P[th * 3 + 1], dz = _ft[2] - sk.P[th * 3 + 2];
  out[0] = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const hx = tgt.x - sk.P[th * 3], hz = tgt.z - sk.P[th * 3 + 2];
  out[1] = Math.sqrt(hx * hx + hz * hz);
  out[2] = _ft[1];
  out[3] = Math.sqrt(dx * dx + dz * dz);
  return out;
}

const PITCH_MAX = 55 * Math.PI / 180, PITCH_STEP = 2.5 * Math.PI / 180;

/**
 * Heel pitch for a toe-locked request: the requested pitch when the leg reaches the ankle target, else the smallest
 * pitch on a 2.5° grid up to 55° (the ankle limit) that reaches, else the pitch with the shortest hip → ankle
 * distance (raising the heel helps when the hip is ahead of the foot, not when it is behind; the scan makes no
 * monotonicity assumption). Shared by footLock and footDropFor so the pelvis drop and the solve agree.
 */
export function toePitchFor(sk, side, tgt, reach) {
  const th = LEG_IK[side][0], hx = sk.P[th * 3], hy = sk.P[th * 3 + 1], hz = sk.P[th * 3 + 2];
  const p0 = tgt.pitch > -PITCH_MAX ? (tgt.pitch < PITCH_MAX ? tgt.pitch : PITCH_MAX) : (tgt.pitch === tgt.pitch ? -PITCH_MAX : 0);
  let best = p0, bestD = 1e9;
  for (let p = p0; p <= PITCH_MAX + 1e-9; p += PITCH_STEP) {
    ankleTargetOf(sk, side, tgt, p, _ft);
    const a = _ft[0] - hx, b = _ft[1] - hy, c = _ft[2] - hz, d = Math.sqrt(a * a + b * b + c * c);
    if (d <= reach) return p;
    if (d < bestD) { bestD = d; best = p; }
    if (p0 >= PITCH_MAX) break;
  }
  return best;
}

/**
 * Pelvis drop (m) needed so that foot request tgt is reachable (with reach R) from a hip at (hx, hy, hz): the highest
 * hip on the reach sphere above the ankle target; toe locks take the most favourable pitch of the same 2.5° grid.
 */
export function footDropFor(sk, side, tgt, hx, hy, hz, R) {
  let best = 1e9;
  // bounded scan: a non-finite request pitch reads as 0 (never an endless loop)
  const p0 = tgt.pitch > -PITCH_MAX ? (tgt.pitch < PITCH_MAX ? tgt.pitch : PITCH_MAX) : (tgt.pitch === tgt.pitch ? -PITCH_MAX : 0);
  for (let p = p0; ; p += PITCH_STEP) {
    ankleTargetOf(sk, side, tgt, p, _ft);
    const dx = _ft[0] - hx, dz = _ft[2] - hz, dh = Math.sqrt(dx * dx + dz * dz);
    const ymax = dh >= R ? _ft[1] : _ft[1] + Math.sqrt(R * R - dh * dh);
    const need = hy - ymax;
    if (need < best) best = need;
    if (tgt.mode !== 1 || p + PITCH_STEP > PITCH_MAX + 1e-9) break;
  }
  return best > 0 ? best : 0;
}

/**
 * Leg IK for one foot request (side 0 = right, 1 = left): solves thigh → calf to the ankle target with the knee pole
 * hip + Ry(yaw)·(0, −0.5, 0.6)·sLeg, then sets the foot's char-frame rotation Ry(yaw)·Rx(pitch) (flat feet: pitch as
 * given, normally 0; toe-locked feet pivot about the ball joint and the toes counter-rotate to stay on the floor).
 * A toe-locked foot that cannot be reached with the requested pitch raises the heel further (toePitchFor: up to
 * 55°, the ankle limit) before the leg straightens. Returns the effector error (m), −1 when the weight is 0.
 */
export function footLock(sk, side, tgt) {
  const w = tgt.w;
  if (w <= 0) return -1;
  const ch = LEG_IK[side], th = ch[0], cf = ch[1], ft = ch[2], bl = ch[3];
  const m = sk.rig.metrics;
  const reach = 0.995 * (m.thighLen + m.calfLen);
  const pitch = tgt.mode === 1 ? toePitchFor(sk, side, tgt, reach) : tgt.pitch;
  ankleTargetOf(sk, side, tgt, pitch, _ft);
  // knee pole: hip + Ry(yaw)·(0, −0.5, 0.6)·sLeg
  const s = m.sLeg, cy = Math.cos(tgt.yaw), sy = Math.sin(tgt.yaw);
  _pole[0] = sk.P[th * 3] + 0.6 * s * sy;
  _pole[1] = sk.P[th * 3 + 1] - 0.5 * s;
  _pole[2] = sk.P[th * 3 + 2] + 0.6 * s * cy;
  const err = twoBoneIK(sk, th, cf, ft, null, _ft, _pole, w, 1, KNEE_HINGE);
  // foot orientation: L_foot = W_calf⁻¹ · W_f (nlerp by weight)
  RyRx(tgt.yaw, pitch, _wf, 0);
  qconj(sk.W, cf * 4, _q4, 0);
  qmul(_q4, 0, _wf, 0, _q4, 0);
  if (w < 1) qnlerp(sk.L, ft * 4, _q4, 0, w, sk.L, ft * 4);
  else { sk.L[ft * 4] = _q4[0]; sk.L[ft * 4 + 1] = _q4[1]; sk.L[ft * 4 + 2] = _q4[2]; sk.L[ft * 4 + 3] = _q4[3]; }
  if (tgt.mode === 1) {
    // toes stay flat: W_toe = Ry·Rx(pitch)·Rx(−toe) = Ry when toe = pitch (toe extension limit 60°)
    let toe = pitch > 0 ? pitch : 0;
    if (toe > 60 * Math.PI / 180) toe = 60 * Math.PI / 180;
    axisAngle(1, 0, 0, -toe, _q4, 0);
    if (w < 1) qnlerp(sk.L, bl * 4, _q4, 0, w, sk.L, bl * 4);
    else { sk.L[bl * 4] = _q4[0]; sk.L[bl * 4 + 1] = _q4[1]; sk.L[bl * 4 + 2] = _q4[2]; sk.L[bl * 4 + 3] = _q4[3]; }
  }
  sk.fkSub(ft);
  return err;
}

// ---------------------------------------------------------------------------------------------------------------
// Hands
// ---------------------------------------------------------------------------------------------------------------

const _eff = new Float64Array(3);
const _hingeL = [new Float64Array(3), new Float64Array(3)];
let _hingeRig = null;

/** Lower-arm hinge (the F_la x column: positive rotation extends the elbow), cached per rig. */
function elbowHinge(rig, side) {
  if (_hingeRig !== rig) {
    _hingeRig = rig;
    const xr = rig.frames.axes_la_r.X, xl = rig.frames.axes_la_l.X;
    _hingeL[0][0] = xr[0]; _hingeL[0][1] = xr[1]; _hingeL[0][2] = xr[2];
    _hingeL[1][0] = xl[0]; _hingeL[1][1] = xl[1]; _hingeL[1][2] = xl[2];
  }
  return _hingeL[side];
}

/**
 * Moves socket sockIdx of the hand of `side` (0 right, 1 left; palm / ball1 / rimHook sockets, all parented to the
 * hand) to `point` (char frame) with the upper arm → forearm chain. pole = char-frame elbow hint or null (keep the
 * current elbow plane). Returns the remaining error (m).
 */
export function handToPoint(sk, side, sockIdx, point, pole, weight = 1, poleW = 1) {
  const ch = ARM_IK[side], s = sk.rig.sock;
  _eff[0] = s[sockIdx * 4 + 1]; _eff[1] = s[sockIdx * 4 + 2]; _eff[2] = s[sockIdx * 4 + 3];
  return twoBoneIK(sk, ch[1], ch[2], ch[3], _eff, point, pole, weight, poleW, elbowHinge(sk.rig, side));
}

const SOCK_PALM = [0, 1];        // SOCK.palm_r, SOCK.palm_l
const _aimT = new Float64Array(3), _aimPole = new Float64Array(3);

/**
 * Block / contest aim (I4): the palm of the arm whose shoulder is nearer `target` (char frame, the ball) reaches for
 * it with weight w. The target is kept at least 0.35 m above that shoulder (a block reaches up, never down into the
 * shooter's chest); balls more than 0.45 m beyond the arm's reach are ignored (no flailing at far balls); an
 * unreachable ball gets the straight arm pointed at it. `side` 0 / 1 keeps an arm already chosen (no switching arms
 * mid-jump), −1 chooses. sk needs valid FK of both arm chains. Returns the side used (also when out of reach) or −1.
 */
export function aimPalm(sk, target, w, side = -1) {
  if (!(w > 0)) return side;
  const P = sk.P, rp = sk.rig.restPos, r = ARM_IK[0][1] * 3, l = ARM_IK[1][1] * 3;
  const dr = Math.hypot(P[r] - target[0], P[r + 1] - target[1], P[r + 2] - target[2]);
  const dl = Math.hypot(P[l] - target[0], P[l + 1] - target[1], P[l + 2] - target[2]);
  const s = side === 0 || side === 1 ? side : dl < dr ? 1 : 0, ch = ARM_IK[s], sh = ch[1] * 3, la = ch[2] * 3, ha = ch[3] * 3;
  const reach = Math.hypot(rp[la], rp[la + 1], rp[la + 2]) + Math.hypot(rp[ha], rp[ha + 1], rp[ha + 2]) + 0.10;
  if ((s ? dl : dr) > reach + 0.45) return s;
  _aimT[0] = target[0]; _aimT[2] = target[2];
  _aimT[1] = target[1] > P[sh + 1] + 0.35 ? target[1] : P[sh + 1] + 0.35;
  _aimPole[0] = P[sh] + (s === 1 ? 0.35 : -0.35); _aimPole[1] = P[sh + 1] - 0.10; _aimPole[2] = P[sh + 2] + 0.05;
  handToPoint(sk, s, SOCK_PALM[s], _aimT, _aimPole, w > 1 ? 1 : w, 0.5);
  return s;
}

const SOCK_BALL1 = [2, 3];       // SOCK.ball1_r, SOCK.ball1_l

/** Puts the ball1 socket of hand `side` on the ball centre `ball` (char frame), keeping the elbow plane. */
export function handOnBall(sk, side, ball, weight = 1) {
  return handToPoint(sk, side, SOCK_BALL1[side], ball, null, weight, 0);
}

// ---------------------------------------------------------------------------------------------------------------
// Pop guard (Animator.popGuard; moved here from animator.js in I4 to keep that file under the 1,600-line cap)
// ---------------------------------------------------------------------------------------------------------------

/** Pop guard limits: at most 22° per shown update, or 660°/s over longer frames. */
const GUARD_MIN = 22 * Math.PI / 180, GUARD_RATE = 660 * Math.PI / 180;
/** Bones the pop guard limits: 1 = always (pelvis, spine, legs, fingers), 2 = arms only while the hands need no exact
 *  contact (no ball, no action clip, no dunk reach). Neck and head stay free (look-at has its own rate limits). */
export const GUARDED = new Uint8Array(BONE_COUNT);
for (const n of ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r']) GUARDED[BONE[n]] = 1;
for (let b = 0; b < BONE_COUNT; b++) if (/^(thumb|index|middle|ring|pinky)_/.test(BONE_NAMES[b])) GUARDED[b] = 1;
for (const n of ['clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r']) GUARDED[BONE[n]] = 2;   // 2 = only off the ball

/**
 * Limits every GUARDED bone-local rotation of L (quaternions × BONE_COUNT) with level ≤ `arms` to max(GUARD_MIN,
 * GUARD_RATE·dt) away from the reference G, then copies L into G. Returns true when any bone was limited (FK needed).
 */
export function guardPose(L, G, arms, dt) {
  const maxA = Math.max(GUARD_MIN, GUARD_RATE * dt);
  let changed = false;
  for (let b = 0; b < BONE_COUNT; b++) {
    const o = b * 4;
    if (GUARDED[b] < 1 || GUARDED[b] > arms) { G[o] = L[o]; G[o + 1] = L[o + 1]; G[o + 2] = L[o + 2]; G[o + 3] = L[o + 3]; continue; }
    const d = L[o] * G[o] + L[o + 1] * G[o + 1] + L[o + 2] * G[o + 2] + L[o + 3] * G[o + 3];
    const ad = d < 0 ? -d : d;
    const ang = 2 * Math.acos(ad > 1 ? 1 : ad);
    if (ang > maxA) { qnlerp(G, o, L, o, maxA / ang, L, o); changed = true; }
    G[o] = L[o]; G[o + 1] = L[o + 1]; G[o + 2] = L[o + 2]; G[o + 3] = L[o + 3];
  }
  return changed;
}
