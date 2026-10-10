/**
 * locomotion.js — procedural gait: walk / jog / run / sprint / backpedal / open-hip side run / defensive slide /
 * idle stances with settle steps, turn-in-place, weight shifts, starts, hard stops and plant-foot cuts
 * (spec §4.7, [ANIM §3]); plus the pose-writer helpers every procedural layer uses.
 *
 * Exports
 *   Gait (class), GAIT (mode codes), STANCE_CODE (stance name → code), stanceCodeOf(name), gaitParams(v, out),
 *   strideOf(hipH, v, strideMul) (stride λ, two steps), stepWidthOf(v), FOOT (foot state codes), and the pose writers
 *   poseAxial, posePelvis, poseSpine, poseSpine3, poseNeck, poseClav, poseArm, poseLeg, poseFingers, poseChannels,
 *   CH (channel-vector layout), stanceChannels(name, playerId) (Float64Array channel vector of a stance).
 *
 * Gait API (called by Animator; deterministic, zero allocation after construction):
 *   new Gait(rig, playerId)
 *   update(dt, inp)        once per fixed step; inp = { x, z, vx, vz, yaw, onDefence, stance (STANCE_CODE), airborne,
 *                          stamina, rng (cosmetic Rng: next() → [0, 1)) }
 *   writePose(pose, alpha) base pose at the render time (alpha ∈ [0, 1] between the last two steps) and the render
 *                          foot targets `foot[s]` (s 0 = right, 1 = left): world { x, y, z, yaw, pitch, mode, w, planted }
 *   replant(s, x, z, yaw, mode, pitch)  adopts a foot position (after an action clip, teleport, catch-up step)
 *   catchUp(s)             auto-released foot: 0.18 s catch-up step to its current target, arc 0.06·sLeg
 *   reset(x, z, yaw)       teleport: phase reset, feet keep their root-relative offsets, then settle steps
 *   fields: mode, phi, rate, speed, heading, ax, az (3-step acceleration), strikes, plantEv (bit 1 R, bit 2 L: a
 *   hard-stop / cut plant happened this step; plantKind 1 = hard stop, 2 = cut), settleCount, slideT.
 *
 * Numbers ([ANIM §3.2] table, linear between the anchor speeds 0.25 / 1.4 / 2.0 / 3.2 / 5.2 / 7.0 / 9.0 m/s; lengths
 * × sLeg). Stride λ = 2.3·hipH·(v²/(g·hipH))^0.3·STYLE.stride, cycle rate v/λ (cadence 2v/λ). Left foot phase φ, right
 * φ + 0.5; stance while (φ_f mod 1) < β. A foot plants at the root predicted at the middle of its stance
 * (t + 0.5·β·λ/v) + the half step width to its side, so the hip passes over it at mid-stance; the swing follows the
 * cubic Bézier of [ANIM §3.3] (heel recovery / reach controls) with smootherstep timing; the target is re-predicted
 * during the first 70 % of the swing, then frozen. Pelvis bob A·(½ ∓ ½·cos 4π(φ − β/2)) (− walk: highest at
 * mid-stance; + run: lowest), the sign cross-fading over 2.0–2.4 m/s. Shoulders counter-rotate (spine_02 and spine_03
 * each −0.8 × the pelvis yaw oscillation), arms swing opposite to the legs (right arm forward at the left strike), the
 * head pitch cancels 85 % of the trunk pitch.
 *
 * Decisions where the spec is silent: idle is entered below 0.18 m/s and left at ≥ 0.25 m/s (hysteresis, so a
 * player creeping at 0.2 m/s does not flicker between stance and gait); the first two steps from idle run the cycle
 * 15 % faster (the step length then follows from the still-low velocity); band changes (forward / side / back /
 * slide) re-time the cycle from the feet (the foot farther behind lifts next) so no foot ever teleports; the pelvis
 * drop that keeps planted feet reachable is computed by the Animator after FK (the [ANIM §3.3] `leanDrop` term).
 */
import { BONE, anatQuat, AQ, qmul, qconj } from './rig.js';
import { rhythmElev } from './clip.js';
import { FINGER_ID, FINGER_BONES, fingerQuats, STANCE, STYLE, LEG } from './presets.js';

const G = 9.81;
const DEG = Math.PI / 180;
const TAU = 2 * Math.PI;

// ---------------------------------------------------------------------------------------------------------------
// Pose writers (anatomical channels → Pose quaternions; side 0 = right, 1 = left)
// ---------------------------------------------------------------------------------------------------------------

const SIDE_SGN = [-1, 1];          // anatQuat side: −1 right, +1 left
const ARM_B = [[BONE.clavicle_r, BONE.upperarm_r, BONE.lowerarm_r, BONE.hand_r], [BONE.clavicle_l, BONE.upperarm_l, BONE.lowerarm_l, BONE.hand_l]];
const LEG_B = [[BONE.thigh_r, BONE.calf_r, BONE.foot_r, BONE.ball_r], [BONE.thigh_l, BONE.calf_l, BONE.foot_l, BONE.ball_l]];
const _c3 = new Float64Array(3), _qa = new Float64Array(4), _qc = new Float64Array(4);

/** Axial bone b ← Ry(yaw)·Rx(pitch)·Rz(−roll) (degrees), tracked. */
export function poseAxial(pose, b, pitch, yaw, roll) {
  _c3[0] = pitch; _c3[1] = yaw; _c3[2] = roll;
  anatQuat(AQ.AXIAL, 0, _c3, pose.q, b * 4);
  pose.w[b] = 1;
}

/** Pelvis offsets (reference metres, × sLeg at output) and rotation (degrees). */
export function posePelvis(pose, dx, dy, dz, pitch, yaw, roll) {
  pose.pel[0] = dx; pose.pel[1] = dy; pose.pel[2] = dz; pose.pelW = 1;
  poseAxial(pose, BONE.pelvis, pitch, yaw, roll);
}

/** Total spine [pitch, yaw, roll] split 0.30/0.35/0.35 (pitch, roll) and 0.30/0.33/0.37 (yaw) ([ANIM §1.3]). */
export function poseSpine(pose, pitch, yaw, roll) {
  poseAxial(pose, BONE.spine_01, 0.30 * pitch, 0.30 * yaw, 0.30 * roll);
  poseAxial(pose, BONE.spine_02, 0.35 * pitch, 0.33 * yaw, 0.35 * roll);
  poseAxial(pose, BONE.spine_03, 0.35 * pitch, 0.37 * yaw, 0.35 * roll);
}

/** Explicit spine_01 / 02 / 03 values (degrees). */
export function poseSpine3(pose, p1, y1, r1, p2, y2, r2, p3, y3, r3) {
  poseAxial(pose, BONE.spine_01, p1, y1, r1);
  poseAxial(pose, BONE.spine_02, p2, y2, r2);
  poseAxial(pose, BONE.spine_03, p3, y3, r3);
}

/** Neck + head [pitch, yaw, roll] split 0.40 / 0.60. */
export function poseNeck(pose, pitch, yaw, roll) {
  poseAxial(pose, BONE.neck_01, 0.40 * pitch, 0.40 * yaw, 0.40 * roll);
  poseAxial(pose, BONE.head, 0.60 * pitch, 0.60 * yaw, 0.60 * roll);
}

/** Clavicle [elev, prot] of side s. */
export function poseClav(pose, s, elev, prot) {
  _c3[0] = elev; _c3[1] = prot; _c3[2] = 0;
  const b = ARM_B[s][0];
  anatQuat(AQ.CLAV, SIDE_SGN[s], _c3, pose.q, b * 4);
  pose.w[b] = 1;
}

/**
 * Arm of side s from a 7-channel array a[o..o+6] = [flex, abd, int, elbow, pron, wFlex, wDev] plus the clavicle
 * [elev, prot]. Applies the scapulohumeral rhythm like the clip compiler: the automatic shrug (0.22·max(0, elev − 60°),
 * ≤ 26°, clavicle limit 35°) raises the shoulder and the upper arm is pre-multiplied by the inverse of that clavicle
 * rotation so the authored arm direction is kept.
 */
export function poseArm(pose, s, a, o = 0, clavElev = 0, clavProt = 0, rhythm = true) {
  const sg = SIDE_SGN[s], B = ARM_B[s];
  let auto = rhythm ? rhythmElev(a[o], a[o + 1], a[o + 2], sg) : 0;
  let elev = clavElev + auto;
  if (elev > 35) { auto -= elev - 35; elev = 35; }
  if (auto < 0) auto = 0;
  _c3[0] = elev; _c3[1] = clavProt; _c3[2] = 0;
  anatQuat(AQ.CLAV, sg, _c3, pose.q, B[0] * 4); pose.w[B[0]] = 1;
  _c3[0] = a[o]; _c3[1] = a[o + 1]; _c3[2] = a[o + 2];
  if (auto > 0) {
    anatQuat(AQ.UPPERARM, sg, _c3, _qa, 0);
    _c3[0] = auto; _c3[1] = 0;
    anatQuat(AQ.CLAV, sg, _c3, _qc, 0);
    qconj(_qc, 0, _qc, 0);
    qmul(_qc, 0, _qa, 0, pose.q, B[1] * 4);
  } else anatQuat(AQ.UPPERARM, sg, _c3, pose.q, B[1] * 4);
  pose.w[B[1]] = 1;
  _c3[0] = a[o + 3]; _c3[1] = a[o + 4];
  anatQuat(AQ.LOWERARM, sg, _c3, pose.q, B[2] * 4); pose.w[B[2]] = 1;
  _c3[0] = a[o + 4]; _c3[1] = a[o + 5]; _c3[2] = a[o + 6];
  anatQuat(AQ.HAND, sg, _c3, pose.q, B[3] * 4); pose.w[B[3]] = 1;
}

/** Leg of side s from a[o..o+5] = [hip, abd, int, knee, ank, toe]. */
export function poseLeg(pose, s, a, o = 0) {
  const sg = SIDE_SGN[s], B = LEG_B[s];
  _c3[0] = a[o]; _c3[1] = a[o + 1]; _c3[2] = a[o + 2];
  anatQuat(AQ.THIGH, sg, _c3, pose.q, B[0] * 4); pose.w[B[0]] = 1;
  _c3[0] = a[o + 3];
  anatQuat(AQ.CALF, sg, _c3, pose.q, B[1] * 4); pose.w[B[1]] = 1;
  _c3[0] = a[o + 4]; _c3[1] = 0;
  anatQuat(AQ.FOOT, sg, _c3, pose.q, B[2] * 4); pose.w[B[2]] = 1;
  _c3[0] = a[o + 5];
  anatQuat(AQ.TOE, sg, _c3, pose.q, B[3] * 4); pose.w[B[3]] = 1;
}

const _fq = new Float32Array(60);
/** Finger preset presetId on hand s (t = seconds for the animated curlTape), tracked; pose.fingers[s] = id. */
export function poseFingers(pose, s, presetId, t = 0) {
  fingerQuats(presetId, s, t, _fq, 0);
  const bones = s === 0 ? FINGER_BONES.r : FINGER_BONES.l;
  for (let k = 0; k < 15; k++) {
    const b = bones[k], o = k * 4;
    pose.q[b * 4] = _fq[o]; pose.q[b * 4 + 1] = _fq[o + 1]; pose.q[b * 4 + 2] = _fq[o + 2]; pose.q[b * 4 + 3] = _fq[o + 3];
    pose.w[b] = 1;
  }
  pose.fingers[s] = presetId;
}

// ---------------------------------------------------------------------------------------------------------------
// Channel vectors (stances and the moving gait are blended as numbers, then written once)
// ---------------------------------------------------------------------------------------------------------------

/** Channel-vector layout (Float64Array(CH.N)). Feet: [x, z, yawDeg, mode] in the facing frame (× sLeg). */
export const CH = Object.freeze({
  P: 0, S: 6, N: 9, RA: 12, LA: 19, RL: 26, LL: 32, RC: 38, LC: 40, FR: 42, FL: 43, RFT: 44, LFT: 48, ANK: 52, N_: 53,
});
const NCH = CH.N_;

/** Stance names → codes (Gait input `stance`). */
export const STANCE_CODE = Object.freeze({ stand: 0, tripleThreat: 1, postUp: 2, postSeal: 3, boxOut: 4, def: 5 });
const STANCE_NAMES = ['stand', 'tripleThreat', 'postUp', 'postSeal', 'boxOut', 'def'];
/** Stance name → code (unknown names → stand). */
export function stanceCodeOf(name) { const c = STANCE_CODE[name]; return c === undefined ? 0 : c; }

function put(v, o, a, n) { for (let i = 0; i < n; i++) v[o + i] = a ? a[i] : 0; }

/** Channel vector of stance `name` for player id (the per-player defensive stance for 'def'). Allocates (load time). */
export function stanceChannels(name, id) {
  const v = new Float64Array(NCH);
  const s = name === 'def' ? (STANCE.def[id] || STANCE.def.default) : STANCE[name];
  put(v, CH.P, s.P, 6); put(v, CH.S, s.S, 3); put(v, CH.N, s.N, 3);
  put(v, CH.RA, s.RA || s.LA, 7); put(v, CH.LA, s.LA || s.RA, 7);
  put(v, CH.RL, s.RL || s.legs, 6); put(v, CH.LL, s.LL || s.legs, 6);
  const fR = s.RF || s.F || 'relax', fL = s.LF || s.F || 'relax';
  v[CH.FR] = FINGER_ID[fR]; v[CH.FL] = FINGER_ID[fL];
  if (name === 'def') {
    const w = s.width;
    v[CH.RFT] = -w / 2; v[CH.RFT + 1] = 0.03; v[CH.RFT + 2] = -10; v[CH.RFT + 3] = 1;
    v[CH.LFT] = w / 2; v[CH.LFT + 1] = -0.03; v[CH.LFT + 2] = 10; v[CH.LFT + 3] = 1;
    v[CH.ANK] = 8;
    if (id === 'yao') put(v, CH.RL, LEG.defYao, 6), put(v, CH.LL, LEG.defYao, 6);
  } else {
    v[CH.RFT] = s.Rft[0]; v[CH.RFT + 1] = s.Rft[1]; v[CH.RFT + 2] = s.Rft[2]; v[CH.RFT + 3] = s.Rft[3] === 't' ? 1 : 0;
    v[CH.LFT] = s.Lft[0]; v[CH.LFT + 1] = s.Lft[1]; v[CH.LFT + 2] = s.Lft[2]; v[CH.LFT + 3] = s.Lft[3] === 't' ? 1 : 0;
    v[CH.ANK] = 0;
  }
  return v;
}

/** Writes a channel vector into pose (pelvis, spine, neck, clavicles + arms with rhythm, legs, fingers at time t). */
export function poseChannels(pose, v, t = 0) {
  posePelvis(pose, v[CH.P], v[CH.P + 1], v[CH.P + 2], v[CH.P + 3], v[CH.P + 4], v[CH.P + 5]);
  poseSpine(pose, v[CH.S], v[CH.S + 1], v[CH.S + 2]);
  poseNeck(pose, v[CH.N], v[CH.N + 1], v[CH.N + 2]);
  poseArm(pose, 0, v, CH.RA, v[CH.RC], v[CH.RC + 1]);
  poseArm(pose, 1, v, CH.LA, v[CH.LC], v[CH.LC + 1]);
  poseLeg(pose, 0, v, CH.RL);
  poseLeg(pose, 1, v, CH.LL);
  poseFingers(pose, 0, v[CH.FR] | 0, t);
  poseFingers(pose, 1, v[CH.FL] | 0, t);
}

// ---------------------------------------------------------------------------------------------------------------
// Gait parameter table ([ANIM §3.2]) and stride
// ---------------------------------------------------------------------------------------------------------------

const V_ANCH = Float64Array.from([0.25, 1.4, 2.0, 3.2, 5.2, 7.0, 9.0]);
const TAB = Object.freeze({
  beta: [0.66, 0.62, 0.58, 0.42, 0.36, 0.30, 0.27],
  swingH: [0.04, 0.08, 0.10, 0.16, 0.24, 0.30, 0.32],
  baseDrop: [0.00, 0.01, 0.02, 0.04, 0.06, 0.07, 0.08],
  bob: [0.010, 0.025, 0.025, 0.045, 0.050, 0.045, 0.040],
  pYaw: [2, 5, 6, 7, 8, 9, 9],
  pRoll: [2, 4, 4, 3, 3, 2, 2],
  sway: [0.010, 0.020, 0.018, 0.012, 0.010, 0.008, 0.006],
  armAmp: [6, 18, 22, 35, 50, 60, 62],
  armBias: [0, 0, 2, 5, 8, 10, 10],
  elbowBase: [12, 15, 25, 75, 85, 90, 92],
  elbowAmp: [4, 10, 12, 12, 15, 15, 15],
  armAbd: [10, 10, 11, 12, 12, 10, 10],
  strike: [-8, -12, -10, -5, 5, 12, 15],
  toeOff: [10, 20, 22, 25, 30, 35, 38],
  // fraction of the stance after which a flat lock becomes a toe lock (flat = 1, toe = 0)
  toeAt: [1, 0.60, 0.60, 0.45, 0, 0, 0],
});
const TAB_KEYS = Object.keys(TAB);

/** Interpolated [ANIM §3.2] parameters at speed v (clamped to the anchors) into out (an object with TAB keys). */
export function gaitParams(v, out) {
  let i = 0;
  while (i < V_ANCH.length - 2 && v > V_ANCH[i + 1]) i++;
  let u = (v - V_ANCH[i]) / (V_ANCH[i + 1] - V_ANCH[i]);
  if (u < 0) u = 0; else if (u > 1) u = 1;
  for (let k = 0; k < TAB_KEYS.length; k++) {
    const r = TAB[TAB_KEYS[k]];
    out[TAB_KEYS[k]] = r[i] + (r[i + 1] - r[i]) * u;
  }
  out.lean = Math.min(20, 2 + 2.3 * v);
  return out;
}

/** Stride λ (two steps, m) at speed v for hip height hipH and STYLE.stride multiplier: Alexander's relation. */
export function strideOf(hipH, v, strideMul = 1) {
  const vv = v < 0.05 ? 0.05 : v;
  return 2.3 * hipH * Math.pow(vv * vv / (G * hipH), 0.3) * strideMul;
}

/** Step width (m, × sLeg): 0.16 walk (≤ 2.0) → 0.10 run (4.0–5.8) → 0.08 sprint (≥ 7.0). */
export function stepWidthOf(v) {
  if (v <= 2.0) return 0.16;
  if (v <= 4.0) return 0.16 - 0.06 * (v - 2.0) / 2.0;
  if (v <= 5.8) return 0.10;
  if (v <= 7.0) return 0.10 - 0.02 * (v - 5.8) / 1.2;
  return 0.08;
}

// ---------------------------------------------------------------------------------------------------------------
// Small math
// ---------------------------------------------------------------------------------------------------------------

function wrapPi(a) { a %= TAU; if (a > Math.PI) a -= TAU; else if (a <= -Math.PI) a += TAU; return a; }
function frac(x) { return x - Math.floor(x); }
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function smooth(u) { return u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u); }
function smoother(u) { return u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (u * (u * 6 - 15) + 10); }
function lerp(a, b, u) { return a + (b - a) * u; }
/** Cubic Bézier scalar. */
function bez(p0, p1, p2, p3, s) { const r = 1 - s; return r * r * r * p0 + 3 * r * r * s * p1 + 3 * r * s * s * p2 + s * s * s * p3; }

// ---------------------------------------------------------------------------------------------------------------
// Gait
// ---------------------------------------------------------------------------------------------------------------

/** Gait modes. */
export const GAIT = Object.freeze({ IDLE: 0, MOVE: 1, SLIDE: 2 });
/** Foot states. */
export const FOOT = Object.freeze({ PLANT: 0, SWING: 1, STEP: 2 });

const BALL_Y = 0.012;               // toe-lock height of the ball joint ([ANIM §2.6.4])
const IDLE_IN = 0.18, IDLE_OUT = 0.25;
const SETTLE_D = 0.12, SETTLE_YAW = 30 * DEG, TURN_YAW = 35 * DEG;
const SETTLE_T = 0.22, TURN_T = 0.20, SETTLE_GAP = 0.06, CATCH_T = 0.18;

class FootState {
  constructor(s) {
    this.s = s;                                     // 0 right, 1 left
    this.state = FOOT.PLANT;
    this.ax = 0; this.az = 0;                       // anchor (world xz): ankle (flat) or ball joint (toe)
    this.yaw = 0; this.mode = 0; this.pitch = 0;
    // swing / step
    this.b0x = 0; this.b0y = 0; this.b0z = 0; this.b0yaw = 0; this.b0pitch = 0;
    this.b3x = 0; this.b3z = 0; this.b3yaw = 0; this.b3mode = 0; this.b3pitch = 0;
    this.stepT = 0; this.stepDur = 0.22; this.stepH = 0.05; this.stepPrevT = 0;
    this.toe = 0;                                   // 1 when this stance switched to a toe lock
    this.ext = 0;                                   // extra stance time (cut)
    this.cut = 0;                                   // pending cut magnitude (rad) for this foot's next plant
    this.cutOut = 0;                                // outward offset (m) of the pending cut
    this.hard = 0;                                  // pending hard-stop plant
    // render output (world)
    this.x = 0; this.y = 0; this.z = 0; this.oyaw = 0; this.opitch = 0; this.omode = 0; this.w = 1; this.planted = 1;
    this.swingU = 0;                                // render swing progress (0 when planted)
  }
}

/** Procedural locomotion of one player (module header). */
export class Gait {
  /**
   * @param {object} rig buildRig() result (metrics: hipH, sLeg, ankleY, legLen; restPos for the foot geometry)
   * @param {string} id player id (STYLE, STANCE.def)
   */
  constructor(rig, id) {
    this.rig = rig;
    this.id = id;
    this.style = STYLE[id] || STYLE.kobe;
    const m = rig.metrics;
    this.sLeg = m.sLeg; this.hipH = m.hipH; this.ankleY = m.ankleY;
    // ball-joint offset from the ankle in the foot frame (per side; toe locks pivot about it)
    const rp = rig.restPos;
    this.ballOff = [Float64Array.from([rp[BONE.ball_r * 3], rp[BONE.ball_r * 3 + 1], rp[BONE.ball_r * 3 + 2]]),
      Float64Array.from([rp[BONE.ball_l * 3], rp[BONE.ball_l * 3 + 1], rp[BONE.ball_l * 3 + 2]])];
    this.feet = [new FootState(0), new FootState(1)];
    /** Render foot targets (alias of feet; fields x, y, z, oyaw, opitch, omode, w, planted). */
    this.foot = this.feet;
    this.prm = {}; gaitParams(0, this.prm);
    this.mode = GAIT.IDLE;
    this.phi = 0; this.phiPrev = 0; this.dphi = 0; this.rate = 0;
    this.slPhi = 0; this.slPrev = 0; this.slD = 0; this.slLead = 1; this.slideT = 0; this.slideOpen = 0;
    this.t = 0;
    this.x = 0; this.z = 0; this.yaw = 0; this.vx = 0; this.vz = 0; this.speed = 0; this.heading = 0;
    this.init = false;
    // velocity history (3 steps) → acceleration; heading history (0.15 s) → cuts
    this.hvx = new Float64Array(4); this.hvz = new Float64Array(4); this.hn = 0;
    this.ax = 0; this.az = 0; this.yawRate = 0; this.prevYaw = 0;
    this.headHist = new Float64Array(10); this.headN = 0;
    // band weights (forward / side / back) and smoothed render values
    this.wF = 1; this.wS = 0; this.wB = 0; this.band = 0;
    this.latSign = 1;
    this.startSteps = 0;
    this.moveW = 0;                                 // 0 = stance, 1 = gait (render blend, 0.20 s)
    this.slideW = 0;
    this.strikes = 0; this.strikesR = 0; this.strikesL = 0;
    this.plantEv = 0; this.plantKind = 0; this.plantDecel = 0; this.plantTurn = 0;
    // idle
    this.stance = 0; this.onDefence = false;
    this.stTarget = 0;
    this.stCh = stanceChannels('stand', id);        // current blended stance channels
    this.stFrom = new Float64Array(NCH); this.stFade = 1; this.stFadeT = 0.25;
    this.stTab = STANCE_NAMES.map((n) => stanceChannels(n, id));
    this.settleCount = 0; this.settleGap = 0; this.idleT = 0; this.turnDir = 0;
    this.shiftT = 2.5; this.shiftSide = 1; this.shiftFrom = 0; this.shiftTo = 0; this.shiftU = 1;
    this.hardT = -1; this.cutT = -1; this.cutMag = 0; this.cutSign = 0; this.cutCool = 0;
    this.stamina = 1;
    // render scratch
    this.ch = new Float64Array(NCH);
    this.gch = new Float64Array(NCH);
    this.airborne = false;
    this.renderT = 0;
  }

  // ------------------------------------------------------------------ helpers
  /** Facing-frame offset (cx left, cz forward) of the root → world x / z. */
  wx(cx, cz) { return this.x + cx * Math.cos(this.yaw) + cz * Math.sin(this.yaw); }
  wz(cx, cz) { return this.z - cx * Math.sin(this.yaw) + cz * Math.cos(this.yaw); }

  /** Ankle (x, z) of a foot from its anchor (toe anchors are the ball joint). Writes into this._ank. */
  ankleOf(f) {
    if (f.mode === 0) { _ank[0] = f.ax; _ank[1] = this.ankleY; _ank[2] = f.az; return _ank; }
    // ankle = ball − Ry(yaw)·Rx(pitch)·ballOff
    const o = this.ballOff[f.s], p = f.pitch, cy = Math.cos(f.yaw), sy = Math.sin(f.yaw), cp = Math.cos(p), sp = Math.sin(p);
    const ry = o[1] * cp - o[2] * sp, rz = o[1] * sp + o[2] * cp;     // Rx(p)
    const wx = o[0] * cy + rz * sy, wz = -o[0] * sy + rz * cy;          // Ry(yaw)
    _ank[0] = f.ax - wx; _ank[1] = BALL_Y - ry; _ank[2] = f.az - wz;
    return _ank;
  }

  /** Converts a flat anchor to a toe anchor (ball joint of the flat foot). */
  toToe(f) {
    if (f.mode === 1) return;
    const o = this.ballOff[f.s], cy = Math.cos(f.yaw), sy = Math.sin(f.yaw);
    f.ax += o[0] * cy + o[2] * sy; f.az += -o[0] * sy + o[2] * cy;
    f.mode = 1;
  }

  /** Stance target of foot s for the current stance (world ankle point, yaw, mode) into _tg. */
  stanceTarget(s) {
    const c = this.stTab[this.stance], o = s === 0 ? CH.RFT : CH.LFT, sL = this.sLeg;
    _tg[0] = this.wx(c[o] * sL, c[o + 1] * sL); _tg[1] = this.wz(c[o] * sL, c[o + 1] * sL);
    _tg[2] = this.yaw + c[o + 2] * DEG; _tg[3] = c[o + 3];
    return _tg;
  }

  /** Plants a foot at an ankle point (x, z) with yaw / mode (converted to a toe anchor when mode 1). */
  plantAt(f, x, z, yaw, mode, pitch) {
    f.state = FOOT.PLANT; f.ax = x; f.az = z; f.yaw = yaw; f.mode = 0; f.pitch = 0; f.toe = 0;
    if (mode === 1) { f.pitch = pitch || 0; this.toToe(f); }
  }

  /** Starts a time-based step of foot f to ankle point (x, z) / yaw / mode over dur with apex height h. */
  startStep(f, x, z, yaw, mode, dur, h) {
    const a = this.ankleOf(f);
    f.b0x = a[0]; f.b0y = a[1]; f.b0z = a[2]; f.b0yaw = f.yaw; f.b0pitch = f.mode === 1 ? f.pitch : 0;
    f.b3x = x; f.b3z = z; f.b3yaw = yaw; f.b3mode = mode;
    f.state = FOOT.STEP; f.stepT = 0; f.stepPrevT = 0; f.stepDur = dur; f.stepH = h;
  }

  /** Lift-off into a phase-driven swing. */
  liftOff(f) {
    const a = this.ankleOf(f);
    f.b0x = a[0]; f.b0y = a[1]; f.b0z = a[2]; f.b0yaw = f.yaw; f.b0pitch = f.mode === 1 ? f.pitch : this.prm.toeOff * DEG;
    f.b3x = a[0]; f.b3z = a[2]; f.b3yaw = f.yaw; f.b3mode = 0;
    f.state = FOOT.SWING; f.toe = 0; f.ext = 0;
  }

  // ------------------------------------------------------------------ external control
  /**
   * Teleport (> 1.5 m in one step: formation snap, rematch): phase reset, foot locks released and re-planted on the
   * stance targets of the new root (the Animator's 0.20 s final-pose crossfade carries the legs there, R#37).
   */
  reset(x, z, yaw) {
    this.x = x; this.z = z; this.yaw = yaw; this.prevYaw = yaw;
    for (let s = 0; s < 2; s++) {
      const f = this.feet[s], t = this.stanceTarget(s);
      this.plantAt(f, t[0], t[1], t[2], t[3], this.stTab[this.stance][CH.ANK] * DEG);
      this.renderFoot(f, 1);
    }
    this.phi = 0; this.phiPrev = 0; this.dphi = 0; this.rate = 0; this.moveW = 0; this.slideW = 0;
    this.mode = GAIT.IDLE; this.settleCount = 0; this.settleGap = SETTLE_GAP; this.idleT = 0;
    this.hn = 0; this.headN = 0; this.startSteps = 0; this.hardT = -1; this.cutT = -1;
  }

  /** Adopts a foot position (world ankle point x, z; yaw rad; mode 0 flat / 1 toe with pitch) — e.g. after a clip. */
  replant(s, x, z, yaw, mode = 0, pitch = 0) {
    const f = this.feet[s];
    this.plantAt(f, x, z, yaw, mode, pitch);
    f.x = mode === 1 ? f.ax : x; f.z = mode === 1 ? f.az : z; f.y = mode === 1 ? BALL_Y : this.ankleY;
    f.oyaw = yaw; f.opitch = f.pitch; f.omode = f.mode; f.planted = 1;
    if (this.mode === GAIT.IDLE) { this.settleCount = 0; this.settleGap = SETTLE_GAP; }
  }

  /** Auto-released foot: catch-up step (0.18 s, arc 0.06·sLeg) to its current target. */
  catchUp(s) {
    const f = this.feet[s];
    if (f.state !== FOOT.PLANT) return;
    if (this.mode === GAIT.IDLE) {
      const t = this.stanceTarget(s);
      this.startStep(f, t[0], t[1], t[2], t[3], CATCH_T, 0.06 * this.sLeg);
    } else {
      // the step target: under the hip half a stance ahead (as a regular plant would)
      const tm = this.rate > 1e-6 ? 0.5 * this.prm.beta / this.rate : 0;
      const lat = this.latSign * (s === 1 ? 1 : -1) * 0.5 * stepWidthOf(this.speed) * this.sLeg;
      const hg = this.gaitHeading();
      const x = this.x + this.vx * (CATCH_T + tm) + lat * Math.cos(hg), z = this.z + this.vz * (CATCH_T + tm) - lat * Math.sin(hg);
      this.startStep(f, x, z, this.plantYaw(s, hg), 0, CATCH_T, 0.06 * this.sLeg);
    }
  }

  // ------------------------------------------------------------------ geometry of the moving gait
  /** Heading the legs move along: velocity heading (forward / side bands) or its reverse (back band). */
  gaitHeading() { return this.band === 2 ? this.heading + Math.PI : this.heading; }

  /** Foot yaw at plant: gait heading + 7° toe-out, 30 % toward the facing when |θ| > 50°. */
  plantYaw(s, hg) {
    let yaw = hg + (s === 1 ? 7 : -7) * DEG;
    const th = Math.abs(wrapPi(this.heading - this.yaw));
    if (th > 50 * DEG) yaw += 0.3 * wrapPi(this.yaw - yaw);
    return yaw;
  }

  /** Predicted plant (ankle point) of foot f landing tLand from now with stance duration tSt (moving gait). */
  predictPlant(f, tLand, tSt) {
    const tm = tLand + 0.5 * tSt;
    const hg = this.gaitHeading();
    const sg = (f.s === 1 ? 1 : -1) * this.latSign;
    let w = 0.5 * stepWidthOf(this.speed) * this.sLeg;
    if (f.cut) w += f.cutOut;
    _tg[0] = this.x + this.vx * tm + sg * w * Math.cos(hg);
    _tg[1] = this.z + this.vz * tm - sg * w * Math.sin(hg);
    _tg[2] = this.plantYaw(f.s, hg);
    return _tg;
  }

  /**
   * The plant a swinging / stepping foot is heading for, as the foot request it will become: out = [x, z (world:
   * ankle point, or ball joint for toe plants), yaw, mode (0 flat, 1 toe), pitch (rad)].
   */
  plantRequest(f, out) {
    let mode = f.b3mode, pitch = f.b3mode === 1 ? (f.b3pitch || 8 * DEG) : 0;
    if (f.state === FOOT.SWING && this.mode === GAIT.MOVE) {
      const toe = this.prm.toeAt <= 0 && !f.hard && !f.cut;
      mode = toe ? 1 : 0; pitch = toe ? Math.max(0, this.prm.strike) * DEG : 0;
    }
    let x = f.b3x, z = f.b3z;
    if (mode === 1) {
      // b3 is always the ankle point; a toe plant anchors the ball joint of the flat foot (as toToe does)
      const o = this.ballOff[f.s], cy = Math.cos(f.b3yaw), sy = Math.sin(f.b3yaw);
      x += o[0] * cy + o[2] * sy; z += -o[0] * sy + o[2] * cy;
    }
    out[0] = x; out[1] = z; out[2] = f.b3yaw; out[3] = mode; out[4] = pitch;
    return out;
  }

  // ------------------------------------------------------------------ fixed step
  /** One fixed step (module header). */
  update(dt, inp) {
    this.t += dt;
    this.plantEv = 0; this.plantKind = 0;
    const x = inp.x, z = inp.z;
    if (!this.init) {
      this.x = x; this.z = z; this.yaw = inp.yaw; this.prevYaw = inp.yaw; this.init = true;
      this.stance = inp.stance | 0; this.stTarget = this.stance; this.stCh.set(this.stTab[this.stance]);
      for (let s = 0; s < 2; s++) { const t = this.stanceTarget(s); this.plantAt(this.feet[s], t[0], t[1], t[2], t[3], this.stTab[this.stance][CH.ANK] * DEG); this.renderFoot(this.feet[s], 1); }
    }
    if (Math.hypot(x - this.x, z - this.z) > 1.5) this.reset(x, z, inp.yaw);
    this.x = x; this.z = z;
    this.vx = inp.vx; this.vz = inp.vz;
    this.yawRate = wrapPi(inp.yaw - this.prevYaw) / dt; this.prevYaw = inp.yaw;
    this.yaw = inp.yaw;
    this.onDefence = !!inp.onDefence;
    this.stamina = inp.stamina === undefined ? 1 : inp.stamina;
    this.airborne = !!inp.airborne;
    const v = Math.hypot(this.vx, this.vz);
    this.speed = v;
    if (v > 0.05) this.heading = Math.atan2(this.vx, this.vz);
    // acceleration: finite difference over 3 steps
    const k = this.hn % 4;
    this.hvx[k] = this.vx; this.hvz[k] = this.vz; this.hn++;
    if (this.hn >= 4) {
      const k3 = (this.hn - 4) % 4;
      this.ax = (this.vx - this.hvx[k3]) / (3 * dt); this.az = (this.vz - this.hvz[k3]) / (3 * dt);
    } else { this.ax = 0; this.az = 0; }
    // heading history (cuts): 0.15 s ≈ 9 steps
    this.headHist[this.headN % 10] = this.heading; this.headN++;
    this.updateStance(inp.stance | 0, dt);
    if (this.airborne) { this.phiPrev = this.phi; this.dphi = 0; this.slPrev = this.slPhi; this.slD = 0; return; }
    gaitParams(v, this.prm);
    this.updateBand();
    this.detectEvents(dt, v);
    // ---- mode transitions ----
    const wantSlide = this.onDefence && this.band === 1 && v <= 4.2 && this.slideOpen === 0;
    if (this.mode === GAIT.IDLE) {
      if (v >= IDLE_OUT) this.enterMove(wantSlide ? GAIT.SLIDE : GAIT.MOVE);
    } else if (v < IDLE_IN) this.enterIdle();
    else if (wantSlide && this.mode === GAIT.MOVE) this.enterMove(GAIT.SLIDE);
    else if (!wantSlide && this.mode === GAIT.SLIDE) this.enterMove(GAIT.MOVE);
    // slide → open hips after 1.2 s above 3.5 m/s (re-armed when the player slows or stops defending)
    if (this.mode === GAIT.SLIDE && v > 3.5) { this.slideT += dt; if (this.slideT > 1.2) { this.slideOpen = 1; } }
    else if (v <= 3.0 || !this.onDefence) { this.slideT = 0; this.slideOpen = 0; }
    // ---- advance ----
    if (this.mode === GAIT.MOVE) this.stepMove(dt, v);
    else if (this.mode === GAIT.SLIDE) this.stepSlide(dt, v);
    else this.stepIdle(dt, inp.rng);
    this.stepSteps(dt);
    // render blend weights (0.20 s)
    const tw = this.mode === GAIT.IDLE ? 0 : 1;
    this.moveW += clamp(tw - this.moveW, -dt / 0.20, dt / 0.20);
    const ts = this.mode === GAIT.SLIDE ? 1 : 0;
    this.slideW += clamp(ts - this.slideW, -dt / 0.20, dt / 0.20);
  }

  /** Stance target changes cross-fade over 0.25 s (stance ↔ upright on offence / defence switches). */
  updateStance(code, dt) {
    if (code !== this.stTarget) {
      this.stFrom.set(this.stCh); this.stFade = 0; this.stTarget = code;
      if (this.mode === GAIT.IDLE) { this.settleCount = 0; this.settleGap = SETTLE_GAP; }
    }
    this.stance = code;
    if (this.stFade < 1) {
      this.stFade = Math.min(1, this.stFade + dt / this.stFadeT);
      const u = smooth(this.stFade), to = this.stTab[code];
      for (let i = 0; i < NCH; i++) this.stCh[i] = this.stFrom[i] + (to[i] - this.stFrom[i]) * u;
      this.stCh[CH.FR] = u < 0.5 ? this.stFrom[CH.FR] : to[CH.FR]; this.stCh[CH.FL] = u < 0.5 ? this.stFrom[CH.FL] : to[CH.FL];
    } else this.stCh.set(this.stTab[code]);
  }

  /** Direction bands θ = heading − facing: forward ≤ 50°, side 50–130°, back ≥ 130°, 20° cross-fades. */
  updateBand() {
    const th = Math.abs(wrapPi(this.heading - this.yaw)) / DEG;
    const fs = smooth((th - 40) / 20), sb = smooth((th - 120) / 20);
    this.wF = 1 - fs; this.wB = sb; this.wS = fs - sb;
    // discrete band for foot placement (hysteresis 5°)
    const b = this.band;
    if (b === 0 && th > 55) this.band = th > 135 ? 2 : 1;
    else if (b === 1 && (th < 45 || th > 135)) this.band = th < 45 ? 0 : 2;
    else if (b === 2 && th < 125) this.band = th < 45 ? 0 : 1;
    // lateral sign: the left foot stays on the pelvis' left of the gait heading (hysteresis)
    const hg = this.gaitHeading();
    const pelvisYaw = this.yaw + this.wS * 0.8 * clamp(wrapPi(this.heading - this.yaw), -45 * DEG, 45 * DEG);
    const d = Math.cos(hg - pelvisYaw);      // dot(left(hg), left(pelvis))
    if (d > 0.2) this.latSign = 1; else if (d < -0.2) this.latSign = -1;
  }

  /** Hard stops and plant-foot cuts ([ANIM §3.7]). */
  detectEvents(dt, v) {
    if (this.cutCool > 0) this.cutCool -= dt;
    // hard stop: speed falls below 1.2 with deceleration > 8 m/s²
    const sp = this.speed > 1e-6 ? this.speed : 1e-6;
    const along = (this.ax * this.vx + this.az * this.vz) / sp;
    if (this.mode !== GAIT.IDLE && v < 1.2 && along < -8 && this.hardT < 0) {
      this.hardT = 0;
      this.plantKind = 1; this.plantDecel = -along;
      // the next contact plants flat: mark the foot that lands next
      const f = this.nextLander();
      if (f) f.hard = 1;
    }
    if (this.hardT >= 0) { this.hardT += dt; if (this.hardT > 0.25) this.hardT = -1; }
    // cut: heading change > 35° within 0.15 s at speed > 3.0
    if (this.headN > 9 && v > 3.0 && this.cutCool <= 0 && this.mode === GAIT.MOVE) {
      const old = this.headHist[(this.headN - 10) % 10];
      const d = wrapPi(this.heading - old);
      if (Math.abs(d) > 35 * DEG) {
        this.cutCool = 0.3; this.cutMag = Math.abs(d); this.cutSign = d > 0 ? 1 : -1; this.cutT = 0;
        // cutting left (d > 0) → the right foot is outside
        const out = this.feet[d > 0 ? 0 : 1];
        out.cut = this.cutMag; out.cutOut = 0.15 * this.sLeg;
        this.plantTurn = this.yawRate;
      }
    }
    if (this.cutT >= 0) { this.cutT += dt; if (this.cutT > 0.6) this.cutT = -1; }
  }

  /** The foot that will touch down next (swinging / stepping foot closest to landing), or null. */
  nextLander() {
    let best = null, bt = 1e9;
    for (let s = 0; s < 2; s++) {
      const f = this.feet[s];
      if (f.state === FOOT.PLANT) continue;
      const t = f.state === FOOT.STEP ? f.stepDur - f.stepT : (this.rate > 1e-6 ? (1 - this.footPhase(s)) / this.rate : 1e9);
      if (t < bt) { bt = t; best = f; }
    }
    return best;
  }

  footPhase(s) { return frac(this.phi + (s === 0 ? 0.5 : 0)); }

  /** Converts a phase-driven swing into a time-based step that finishes at its current target in `dur`. */
  swingToStep(f, dur) {
    this.renderFoot(f, 1);
    f.b0x = f.x; f.b0y = f.y; f.b0z = f.z; f.b0yaw = f.oyaw; f.b0pitch = f.opitch;
    f.state = FOOT.STEP; f.stepT = 0; f.stepPrevT = 0; f.stepDur = dur;
    f.stepH = Math.max(0.01, f.y - this.ankleY) + 0.02;
  }

  /** Enters the moving gait (or the slide), re-timing the cycle from the feet. */
  enterMove(mode) {
    const was = this.mode;
    this.mode = mode;
    const v = this.speed;
    if (mode === GAIT.SLIDE) {
      // lead foot = the one on the movement side; it swings first (a foot already in the air finishes as a step)
      const lx = Math.cos(this.yaw), lz = -Math.sin(this.yaw);
      this.slLead = (this.vx * lx + this.vz * lz) >= 0 ? 1 : 0;
      this.slPhi = 0; this.slPrev = 0; this.slD = 0;
      for (let s = 0; s < 2; s++) if (this.feet[s].state === FOOT.SWING) this.swingToStep(this.feet[s], 0.12);
      const lead = this.feet[this.slLead];
      if (lead.state === FOOT.PLANT) { this.liftOff(lead); lead.b0pitch = 8 * DEG; }
      this.slideT = 0;
      return;
    }
    const beta = this.beta();
    const rate = v / this.lambda(v);
    // a foot already in the air keeps swinging (its phase is mapped from its remaining time); otherwise the foot
    // farther behind along the motion lifts now
    let lifter = -1;
    for (let s = 0; s < 2; s++) if (this.feet[s].state !== FOOT.PLANT) lifter = s;
    if (lifter < 0) {
      const mx = v > 1e-6 ? this.vx / v : Math.sin(this.yaw), mz = v > 1e-6 ? this.vz / v : Math.cos(this.yaw);
      const a0 = this.ankleOf(this.feet[0]), d0 = (a0[0] - this.x) * mx + (a0[2] - this.z) * mz;
      const a1 = this.ankleOf(this.feet[1]), d1 = (a1[0] - this.x) * mx + (a1[2] - this.z) * mz;
      lifter = d0 <= d1 ? 0 : 1;
      this.phi = frac(beta - (lifter === 0 ? 0.5 : 0));      // φ_f = β: lift-off now
      this.liftOff(this.feet[lifter]);
    } else {
      const f = this.feet[lifter];
      if (f.state === FOOT.STEP) {
        const tRem = Math.max(0, f.stepDur - f.stepT);
        const u = clamp(1 - tRem * rate / (1 - beta), 0, 0.95);
        this.phi = frac(beta + u * (1 - beta) - (lifter === 0 ? 0.5 : 0));
        f.state = FOOT.SWING;                                // the step's start stays the lift-off point
      } else if (was === GAIT.SLIDE) {
        const u = clamp(this.slideRenderU(lifter, 1), 0, 0.95);
        this.phi = frac(beta + u * (1 - beta) - (lifter === 0 ? 0.5 : 0));
      }
    }
    // the other foot keeps its lock; one still in the air (slide swing) finishes as a short step, a stepping one
    // completes its step (time-based) — no foot ever jumps
    const o = this.feet[1 - lifter];
    if (o.state === FOOT.SWING) this.swingToStep(o, 0.12);
    this.phiPrev = this.phi; this.dphi = 0;
    if (was === GAIT.IDLE) this.startSteps = 2;
  }

  /** Enters idle: swinging feet finish as time-based steps toward their stance targets; settle steps follow. */
  enterIdle() {
    for (let s = 0; s < 2; s++) {
      const f = this.feet[s];
      if (f.state !== FOOT.SWING) continue;
      const u = this.mode === GAIT.SLIDE ? clamp(this.slideRenderU(s, 1), 0, 1) : this.swingU(s);
      const remain = this.rate > 1e-6 ? (1 - u) * (this.mode === GAIT.SLIDE ? 0.25 : 1 - this.beta()) / this.rate : 0.12;
      this.swingToStep(f, clamp(remain, 0.10, 0.25));
      const t = this.stanceTarget(s);
      f.b3x = t[0]; f.b3z = t[1]; f.b3yaw = t[2]; f.b3mode = t[3]; f.b3pitch = this.stTab[this.stance][CH.ANK] * DEG;
    }
    this.mode = GAIT.IDLE;
    this.settleCount = 0; this.settleGap = SETTLE_GAP; this.idleT = 0; this.rate = 0; this.dphi = 0;
  }

  /** Stride with the band multipliers (back band × 0.60). */
  lambda(v) { return strideOf(this.hipH, v, this.style.stride) * (1 - 0.40 * this.wB); }
  /** Duty factor with the back band's +0.06. */
  beta() { return this.prm.beta + 0.06 * this.wB; }

  swingU(s) { const b = this.beta(); return clamp((this.footPhase(s) - b) / (1 - b), 0, 1); }


  /** Moving gait (forward / side / back bands). */
  stepMove(dt, v) {
    const lambda = this.lambda(v), beta = this.beta();
    let rate = v / lambda;
    if (this.startSteps > 0) rate *= 1.15;
    // cut: the outside foot's stance lasts 0.10 + 0.06·Δ/90° longer — the shared cycle slows during that stance
    for (let s = 0; s < 2; s++) {
      const f = this.feet[s];
      if (f.state === FOOT.PLANT && f.ext > 0) { const tSt = beta / rate; rate *= tSt / (tSt + f.ext); }
    }
    this.rate = rate;
    const old = this.phi;
    this.phi = old + rate * dt;
    this.dphi = rate * dt;
    this.phiPrev = old;
    for (let s = 0; s < 2; s++) {
      const f = this.feet[s];
      if (f.state === FOOT.STEP) continue;
      const off = s === 0 ? 0.5 : 0;
      const f0 = frac(old + off), f1 = f0 + rate * dt;
      if (f.state === FOOT.PLANT) {
        // flat → toe lock at toeAt of the stance
        const toeAt = this.prm.toeAt;
        if (f.mode === 0 && toeAt < 1 && f1 / beta >= toeAt && f1 < beta && !f.ext) { f.pitch = 0; this.toToe(f); f.toe = 1; }
        if (f0 < beta && f1 >= beta) { f.ext = 0; this.liftOff(f); }
      } else if (f.state === FOOT.SWING) {
        const u = clamp((f1 - beta) / (1 - beta), 0, 1);
        if (u < 0.7 || f.b3mode === 0 && f.b3x === f.b0x && f.b3z === f.b0z) {
          const tLand = Math.max(0, (1 - f1) / rate);
          const tSt = beta / rate + (f.cut ? 0.10 + 0.06 * f.cut / (90 * DEG) : 0);
          const p = this.predictPlant(f, tLand, tSt);
          f.b3x = p[0]; f.b3z = p[1]; f.b3yaw = p[2];
        }
        if (f1 >= 1) this.footStrike(f);
      }
    }
    this.phi = frac(this.phi);
    for (let s = 0; s < 2; s++) {
      const f = this.feet[s];
      if (f.state === FOOT.PLANT && f.mode === 1) f.pitch = this.stancePitch(f, this.footPhase(s), this.t);
    }
  }

  /** A swinging foot touches down at its target. */
  footStrike(f) {
    const prm = this.prm;
    let yaw = f.b3yaw;
    if (f.cut) {
      // foot yaw halfway between the old and new heading; stance extended; pelvis drop / roll in writePose
      const old = this.headHist[(this.headN + 0) % 10];
      yaw = f.b3yaw + 0.5 * wrapPi(old - f.b3yaw);
      f.ext = 0.10 + 0.06 * f.cut / (90 * DEG);
      this.plantEv |= f.s === 0 ? 1 : 2; this.plantKind = 2; this.plantTurn = this.yawRate;
      this.cutT = 0;
      const pivot = f.cut >= 135 * DEG;
      f.cut = 0; f.cutOut = 0;
      this.plantAt(f, f.b3x, f.b3z, yaw, pivot ? 1 : 0, pivot ? 8 * DEG : 0);
    } else if (f.hard) {
      this.plantAt(f, f.b3x, f.b3z, yaw, 0, 0);
      this.plantEv |= f.s === 0 ? 1 : 2; this.plantKind = 1;
      f.hard = 0;
    } else {
      const toe = prm.toeAt <= 0;
      this.plantAt(f, f.b3x, f.b3z, yaw, toe ? 1 : 0, toe ? Math.max(0, prm.strike) * DEG : 0);
    }
    this.strikes++; if (f.s === 0) this.strikesR++; else this.strikesL++;
    if (this.startSteps > 0) this.startSteps--;
  }

  /** Defensive slide ([ANIM §3.5]): lead steps out by dc in 0–0.25, trail closes in 0.50–0.75. */
  stepSlide(dt, v) {
    const sL = this.sLeg;
    const dc = clamp(0.30 + 0.12 * v, 0.30, 0.75) * sL * this.style.slide;
    const rate = v / dc;
    this.rate = rate;
    const o0 = this.slPhi, o1 = o0 + rate * dt;               // unwrapped cycle phase over this step
    this.slPrev = o0; this.slD = rate * dt;
    const lx = Math.cos(this.yaw), lz = -Math.sin(this.yaw);
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const w0 = (STANCE.def[this.id] || STANCE.def.default).width * sL;
    for (let s = 0; s < 2; s++) {
      const f = this.feet[s];
      if (f.state === FOOT.STEP) continue;
      const lead = s === this.slLead;
      const a = lead ? 0 : 0.5, pl = a + 0.25;
      // lift: the lead at each new cycle (o1 crosses 1), the trail when o crosses 0.5
      const lift = lead ? o1 >= 1 : (o0 < 0.5 && o1 >= 0.5);
      if (f.state === FOOT.PLANT && lift) { this.liftOff(f); f.b0pitch = f.mode === 1 ? f.pitch : 8 * DEG; }
      if (f.state !== FOOT.SWING) continue;
      // phase of this foot's window in the current cycle (the lead's window restarts after the wrap)
      const q1 = lead && o1 >= 1 ? o1 - 1 : o1;
      const tLand = Math.max(0, (pl - Math.min(q1, pl)) / rate);
      const cx = this.x + this.vx * tLand, cz = this.z + this.vz * tLand;
      // each foot keeps its half width on its own side of the character's lateral axis ℓ (σ = +1 left, −1 right);
      // the stride share follows the movement side μ: lead (σ = μ) lands w0/2 + 0.75·dc out, the trail closes to
      // w0/2 − 0.25·dc, so a reversal mid-swing can never carry a foot across the other one
      const sg = s === 1 ? 1 : -1;
      const mu = (this.vx * lx + this.vz * lz) >= 0 ? 1 : -1;
      const share = (lead ? 0.75 : 0.25) * dc;
      const stg = (s === 0 ? 0.03 : -0.03) * sL;                 // stance stagger R +0.03 / L −0.03 (facing frame)
      let lat = sg * w0 / 2 + mu * share;
      // feet never closer than 0.25 m along ℓ (no crossing)
      const oa = this.ankleOf(this.feet[1 - s]);
      const oLat = (oa[0] - cx) * lx + (oa[2] - cz) * lz;
      if (sg * (lat - oLat) < 0.25) lat = oLat + sg * 0.25;
      const px = cx + lx * lat + fx * stg, pz = cz + lz * lat + fz * stg;
      f.b3x = px; f.b3z = pz; f.b3yaw = this.yaw + (s === 1 ? 10 : -10) * DEG; f.b3mode = 1; f.b3pitch = 8 * DEG;
      if (q1 >= pl) {
        this.plantAt(f, f.b3x, f.b3z, f.b3yaw, 1, 8 * DEG);
        this.strikes++; if (s === 0) this.strikesR++; else this.strikesL++;
      }
    }
    let p = o1;
    if (p >= 1) {
      p -= 1;
      // a direction change swaps the lead at a cycle start
      const leadNow = (this.vx * lx + this.vz * lz) >= 0 ? 1 : 0;
      if (leadNow !== this.slLead) this.slLead = leadNow;
    }
    this.slPhi = p;
  }

  /** Idle: settle steps, turn in place, weight shifts. */
  stepIdle(dt, rng) {
    this.rate = 0; this.dphi = 0; this.phiPrev = this.phi;
    this.idleT += dt;
    let stepping = false;
    for (let s = 0; s < 2; s++) if (this.feet[s].state !== FOOT.PLANT) stepping = true;
    if (this.settleGap > 0) this.settleGap -= dt;
    if (!stepping && this.settleGap <= 0) {
      const turning = Math.abs(this.yawRate) > 0.5;
      // candidates
      let best = -1, bestScore = 0;
      for (let s = 0; s < 2; s++) {
        const f = this.feet[s], a = this.ankleOf(f), t = this.stanceTarget(s);
        const d = Math.hypot(a[0] - t[0], a[2] - t[1]);
        const dy = Math.abs(wrapPi(f.yaw - t[2]));
        const need = turning ? dy > TURN_YAW : (d > SETTLE_D * this.sLeg || dy > SETTLE_YAW);
        if (!need) continue;
        // turning left → left foot first; else the farther foot first
        let score = d + dy * 0.3;
        if (turning) score += (this.yawRate > 0) === (s === 1) ? 10 : 0;
        if (score > bestScore) { bestScore = score; best = s; }
      }
      if (best >= 0) {
        // drift beyond 0.25·sLeg re-arms the settle budget (the root moved, e.g. a separation push)
        if (!turning && this.settleCount >= 2) {
          const a = this.ankleOf(this.feet[best]), t = this.stanceTarget(best);
          if (Math.hypot(a[0] - t[0], a[2] - t[1]) > 0.25 * this.sLeg) this.settleCount = 0;
        }
        if (turning || this.settleCount < 2) {
          const t = this.stanceTarget(best);
          const pitch = this.stTab[this.stance][CH.ANK] * DEG;
          this.startStep(this.feet[best], t[0], t[1], t[2], t[3], turning ? TURN_T : SETTLE_T, 0.05 * this.sLeg);
          this.feet[best].b3pitch = pitch;
          if (!turning) this.settleCount++;
        }
      }
    }
    // weight shift every 2.5–4.0 s (cosmetic RNG): pelvis dx ±0.03·sLeg over 0.6 s
    this.shiftT -= dt;
    if (this.shiftT <= 0) {
      const r = rng ? rng.next() : 0.5;
      this.shiftT = 2.5 + 1.5 * r;
      this.shiftSide = -this.shiftSide;
      this.shiftFrom = this.shiftCur(); this.shiftTo = this.shiftSide * 0.03; this.shiftU = 0;
    }
    if (this.shiftU < 1) this.shiftU = Math.min(1, this.shiftU + dt / 0.6);
    // idle toe-bounce rides on toe locks; planted toe feet track the stance pitch (step time)
    const tb = this.style.toeBounce;
    for (let s = 0; s < 2; s++) {
      const f = this.feet[s];
      if (f.state !== FOOT.PLANT) continue;
      if (tb && f.mode === 0 && (this.stance === STANCE_CODE.stand || this.stance === STANCE_CODE.def)) this.toToe(f);
      // a toe-locked heel settles to the stance's ank (+8° defence, 0 otherwise) at 3 rad/s
      if (f.mode === 1) { const tgt = this.stTab[this.stance][CH.ANK] * DEG; f.pitch += clamp(tgt - f.pitch, -3 * dt, 3 * dt); }
    }
  }

  shiftCur() { return this.shiftFrom + (this.shiftTo - this.shiftFrom) * smooth(this.shiftU); }

  /** Advances time-based steps (settle, turn, catch-up). */
  stepSteps(dt) {
    for (let s = 0; s < 2; s++) {
      const f = this.feet[s];
      if (f.state !== FOOT.STEP) continue;
      f.stepPrevT = f.stepT;
      f.stepT += dt;
      if (f.stepT >= f.stepDur) {
        this.plantAt(f, f.b3x, f.b3z, f.b3yaw, f.b3mode, f.b3pitch || 0);
        f.b3pitch = 0;
        this.settleGap = SETTLE_GAP;
      }
    }
  }

  // ------------------------------------------------------------------ render
  /** Writes the base pose at render time and the world foot targets `foot[s]` (module header). */
  writePose(pose, alpha) {
    const sty = this.style, prm = this.prm, sL = this.sLeg;
    // render phases
    const phi = this.phiPrev + alpha * this.dphi;
    const beta = this.beta();
    const v = this.speed;
    const tR = this.t - (1 - alpha) * (1 / 60);
    this.renderT = tR;
    // ---- moving channels ----
    const g = this.gch;
    const runW = smooth((v - 2.0) / 0.4);
    const bobA = prm.bob * sty.bob;
    const c4 = Math.cos(2 * TAU * (phi - beta / 2));
    const bob = bobA * ((1 - runW) * (0.5 - 0.5 * c4) + runW * (0.5 + 0.5 * c4));
    const cs = Math.cos(TAU * phi), cb = Math.cos(TAU * (phi - beta / 2));
    let trunk = prm.lean + sty.leanAdd;
    trunk = lerp(trunk, 4, this.wB);                                      // backpedal: fixed 4° forward
    let pyaw = -prm.pYaw * cs * (1 - this.wB * 0.5);
    let proll = -prm.pRoll * cb;
    const sideYaw = this.wS * 0.8 * clamp(wrapPi(this.heading - this.yaw), -45 * DEG, 45 * DEG) / DEG;
    // hard stop / cut extras
    let extraDrop = 0, extraPitch = 0, extraRoll = 0;
    if (this.hardT >= 0) { const e = Math.sin(Math.PI * clamp(this.hardT / 0.25, 0, 1)); extraDrop += 0.05 * e; extraPitch -= 6 * e; }
    if (this.cutT >= 0) {
      const e = Math.sin(Math.PI * clamp(this.cutT / 0.4, 0, 1)), k = this.cutMag / (90 * DEG);
      extraDrop += (0.04 + 0.04 * k) * e; extraRoll += this.cutSign * (8 + 8 * k) * e;
    }
    g[CH.P] = prm.sway * cb; g[CH.P + 1] = -prm.baseDrop - bob - extraDrop; g[CH.P + 2] = 0;
    g[CH.P + 3] = 0.4 * (trunk + extraPitch); g[CH.P + 4] = pyaw + sideYaw; g[CH.P + 5] = proll + extraRoll;
    g[CH.S] = 0.6 * (trunk + extraPitch); g[CH.S + 1] = 0; g[CH.S + 2] = sty.sway * Math.sin(TAU * phi);
    g[CH.N] = -0.85 * (trunk + extraPitch) + sty.headCarry; g[CH.N + 1] = 0; g[CH.N + 2] = 0;
    // arms: right forward at the left strike
    const off = this.onDefence;
    const sw = sty.armSwing * (off ? 1 - this.wB : 1 - 0.5 * this.wB);
    const amp = prm.armAmp * sw, elA = prm.elbowAmp * sw;
    for (let s = 0; s < 2; s++) {
      const o = s === 0 ? CH.RA : CH.LA, sg = s === 0 ? 1 : -1;
      g[o] = prm.armBias + sg * amp * cs;
      g[o + 1] = prm.armAbd + sty.abdAdd;
      g[o + 2] = 0;
      g[o + 3] = prm.elbowBase + sty.elbowAdd + sg * elA * cs;
      g[o + 4] = 15; g[o + 5] = 0; g[o + 6] = 0;
      if (off && this.wB > 0) {
        // backpedal on defence: [40, 30, 0, 60, 30, 0, 0], no swing
        const k = this.wB;
        g[o] = lerp(g[o], 40, k); g[o + 1] = lerp(g[o + 1], 30, k); g[o + 3] = lerp(g[o + 3], 60, k); g[o + 4] = lerp(g[o + 4], 30, k);
      }
    }
    g[CH.RC] = 0; g[CH.RC + 1] = 0; g[CH.LC] = 0; g[CH.LC + 1] = 0;
    g[CH.FR] = 0; g[CH.FL] = 0;                                          // relax
    // ---- slide: defensive stance body with feet-midpoint pelvis, active hands ----
    if (this.slideW > 0) {
      const d = this.stTab[STANCE_CODE.def], k = this.slideW;
      const sp = this.slPrev + alpha * this.slD;
      for (let i = 0; i < CH.RFT; i++) g[i] = lerp(g[i], d[i], k);
      g[CH.FR] = k > 0.5 ? d[CH.FR] : g[CH.FR]; g[CH.FL] = k > 0.5 ? d[CH.FL] : g[CH.FL];
      g[CH.P + 1] += k * 0.015 * Math.sin(2 * TAU * sp);
      g[CH.P + 4] = lerp(g[CH.P + 4], 0, k);
      // pelvis dx follows the feet midpoint (character x, reference metres)
      const fR = this.feet[0], fL = this.feet[1];
      this.renderFoot(fR, alpha); this.renderFoot(fL, alpha);
      const mx = 0.5 * (fR.x + fL.x) - this.x, mz = 0.5 * (fR.z + fL.z) - this.z;
      const cx = (mx * Math.cos(this.yaw) - mz * Math.sin(this.yaw)) / sL;
      g[CH.P] = lerp(g[CH.P], clamp(cx, -0.40, 0.40), k);
      const hands = 10 * Math.sin(TAU * 2 * tR);
      g[CH.RA] += k * hands; g[CH.LA] -= k * hands;
    }
    // legs: FK hints (the IK places the feet)
    for (let s = 0; s < 2; s++) {
      const o = s === 0 ? CH.RL : CH.LL;
      g[o] = 12; g[o + 1] = 4; g[o + 2] = 0; g[o + 3] = 22; g[o + 4] = 0; g[o + 5] = 0;
    }
    // ---- idle channels (stance + weight shift + style idles) ----
    const c = this.ch;
    c.set(this.stCh);
    const idle = 1 - this.moveW;
    if (idle > 0) {
      const sh = this.shiftCur();
      c[CH.P] += sh;
      c[CH.P + 5] += -3 * (sh / 0.03);
      if (this.stance === STANCE_CODE.def) {
        const ds = STANCE.def[this.id] || STANCE.def.default;
        if (ds.activeHands) { const a = ds.activeHands.flex * Math.sin(TAU * ds.activeHands.hz * tR); c[CH.RA] += a; c[CH.LA] -= a; }
      }
    }
    // ---- blend idle ↔ moving ----
    const mw = smooth(this.moveW);
    for (let i = 0; i < CH.RFT; i++) c[i] = c[i] + (g[i] - c[i]) * mw;
    if (mw > 0.5) { c[CH.FR] = g[CH.FR]; c[CH.FL] = g[CH.FL]; }
    // shoulders counter-rotate: spine_02 / spine_03 yaw each −0.8 × the pelvis yaw oscillation; chest toward ψ
    poseChannels(pose, c, tR);
    // (the slide keeps the pelvis square to ψ: no open-hip yaw and no chest counter-twist)
    const pyR = mw * (pyaw * (1 - this.slideW)), syR = mw * sideYaw * (1 - this.slideW);
    const S = c[CH.S], R = c[CH.S + 2];
    poseSpine3(pose, 0.30 * S, -0.30 * syR, 0.30 * R, 0.35 * S, -0.8 * pyR - 0.33 * syR, 0.35 * R, 0.35 * S, -0.8 * pyR - 0.37 * syR, 0.35 * R);
    // ---- feet ----
    for (let s = 0; s < 2; s++) this.renderFoot(this.feet[s], alpha);
  }

  /**
   * Plantar flexion (rad) of a planted foot at foot phase ph (moving gait) or time t (idle): heel rocker after a
   * dorsiflexed strike, heel rise of toe locks toward the toe-off value, the defensive ank +8 with Kobe's on-ball
   * "feet buzz" (±5° at 4 Hz) and the idle toe-bounce (Giannis 2.0 Hz ±4°, Kyrie 1.6 Hz ±3°). Pure.
   */
  stancePitch(f, ph, t) {
    const prm = this.prm;
    if (this.mode === GAIT.MOVE) {
      const q = clamp(ph / this.beta(), 0, 1);
      if (f.mode === 0) return prm.strike < 0 ? prm.strike * DEG * (1 - smooth(q / 0.15)) : 0;
      if (prm.toeAt <= 0) return (prm.strike > 0 ? prm.strike : 0) * DEG * (1 - smooth(q / 0.4)) + prm.toeOff * DEG * smooth((q - 0.5) / 0.5);
      if (!f.toe) return f.pitch;
      return prm.toeOff * DEG * smooth((q - prm.toeAt) / (1 - prm.toeAt));
    }
    if (this.mode === GAIT.SLIDE) return f.mode === 1 ? 8 * DEG : 0;
    // idle: f.pitch is the step-smoothed base (→ the stance's ank); oscillations are added here
    let pitch = f.mode === 1 ? f.pitch : 0;
    const ds = STANCE.def[this.id];
    if (this.stance === STANCE_CODE.def && ds && ds.buzz && f.mode === 1) pitch += ds.buzz.ank * DEG * Math.sin(TAU * ds.buzz.hz * t);
    const tb = this.style.toeBounce;
    if (tb && f.mode === 1 && (this.stance === STANCE_CODE.stand || this.stance === STANCE_CODE.def)) {
      pitch = (pitch > 0 ? pitch : 0) + tb.ank * DEG * (0.5 - 0.5 * Math.cos(TAU * tb.hz * t));
    }
    return pitch;
  }

  /** Render target of one foot (world) at the render time (pure: writes only the render fields). */
  renderFoot(f, alpha) {
    const prm = this.prm, sL = this.sLeg;
    f.w = 1;
    if (f.state === FOOT.PLANT) {
      f.planted = 1; f.swingU = 0;
      f.x = f.ax; f.z = f.az; f.oyaw = f.yaw; f.omode = f.mode;
      f.y = f.mode === 1 ? BALL_Y : this.ankleY;
      const ph = frac(this.phiPrev + alpha * this.dphi + (f.s === 0 ? 0.5 : 0));
      f.opitch = this.stancePitch(f, ph, this.renderT);
      return;
    }
    f.planted = 0;
    let u;
    if (f.state === FOOT.STEP) u = clamp((f.stepPrevT + alpha * (f.stepT - f.stepPrevT)) / f.stepDur, 0, 1);
    else if (this.mode === GAIT.SLIDE) u = clamp(this.slideRenderU(f.s, alpha), 0, 1);
    else {
      const beta = this.beta();
      const ph = frac(this.phiPrev + alpha * this.dphi + (f.s === 0 ? 0.5 : 0));
      u = ph < beta ? 1 : clamp((ph - beta) / (1 - beta), 0, 1);
    }
    const s = smoother(u);
    f.swingU = u;
    const hgt = f.state === FOOT.STEP ? f.stepH : this.mode === GAIT.SLIDE ? 0.05 * sL : prm.swingH * sL * (1 - 0.4 * this.wB);
    const hg = this.gaitHeading();
    const fxh = Math.sin(hg), fzh = Math.cos(hg);
    // heel recovery / reach controls only for the running swing ([ANIM §3.3])
    const rec = f.state === FOOT.SWING && this.mode === GAIT.MOVE ? 0.10 * sL : 0;
    const y3 = this.ankleY;
    const x1 = f.b0x - fxh * rec, z1 = f.b0z - fzh * rec, y1 = f.b0y + 1.2 * hgt;
    const x2 = f.b3x + fxh * rec, z2 = f.b3z + fzh * rec, y2 = y3 + 0.6 * hgt;
    f.x = bez(f.b0x, x1, x2, f.b3x, s); f.z = bez(f.b0z, z1, z2, f.b3z, s); f.y = bez(f.b0y, y1, y2, y3, s);
    f.oyaw = f.b0yaw + wrapPi(f.b3yaw - f.b0yaw) * s;
    f.omode = 0;
    if (f.state === FOOT.SWING && this.mode === GAIT.MOVE) {
      // toe-off → −10° at mid-swing → strike pitch
      f.opitch = u < 0.5 ? lerp(f.b0pitch, -10 * DEG, smooth(u / 0.5)) : lerp(-10 * DEG, prm.strike * DEG, smooth((u - 0.5) / 0.5));
    } else {
      // steps and slides land on the target pitch (toe-locked slides: +8°), toes up a little mid-air
      const end = f.b3mode === 1 ? (f.b3pitch || 0) : 0;
      f.opitch = lerp(f.b0pitch, end, s) - 6 * DEG * Math.sin(Math.PI * u);
    }
  }

  /** Slide swing progress of foot s at render alpha. */
  slideRenderU(s, alpha) {
    const p = this.slPrev + alpha * this.slD;
    const lead = s === this.slLead;
    return lead ? p / 0.25 : (p - 0.5) / 0.25;
  }
}

const _ank = new Float64Array(3);
const _tg = new Float64Array(4);
