/**
 * pose.js — the animation Pose container, masks and pose blending (spec §4.2–§4.3, [ANIM §2.3]).
 *
 * Exports
 *   Pose (class), copyPose(dst, src), resetPose(p), blendPose(out, a, b, w, maskW), addPose(out, add, w),
 *   MASK (name → code), MASK_NAMES, MASK_W (Float32Array(53) per mask code), MASK_ROOT (root/pelvis-offset column
 *   per mask code), maskCode(name), EXPR (name → channel), EXPR_NAMES (spec §3.9 order), LOOK (look-at target codes).
 *
 * A Pose is the output of one layer (clip sample, gait, stance): anatomical quaternions per bone (`q`, bind = I),
 * per-bone ownership weights (`w`: 1 = this pose defines the bone, 0 = untracked → lower layers show through),
 * pelvis offsets in reference metres (`pel`, multiply by sLeg at output), the clip root curve sample (`root`:
 * x, z (m), yaw (rad)), ball mode (`ball`, BM code), ball path point (`bpath`), dominant finger preset per hand
 * (`fingers`: [right, left] preset ids, −1 = none; used by the automatic grip), expression weights (`expr`) with
 * their keyed flags (`exprK`), foot plant targets (`ftRL`: [xR, zR, yawR(rad), modeR, xL, zL, yawL, modeL], mode
 * 0 flat / 1 toe; `ftOn`: [R, L] 1 = planted), look-at (`look`: [code, weight]).
 * Every array is allocated once in the constructor; blending never allocates (H10).
 */
import { BONE_COUNT, BONE, BONE_NAMES, BONE_SIDE, qnlerp, qmul } from './rig.js';

/** Expression channel names in morph order (spec §3.9). */
export const EXPR_NAMES = Object.freeze(['jawOpen', 'tongueOut', 'jawJut', 'roar', 'grin', 'smirk', 'scowl', 'puff', 'blink']);
/** Expression name → channel index. */
export const EXPR = Object.freeze(Object.fromEntries(EXPR_NAMES.map((n, i) => [n, i])));
/** Look-at target codes (0 = not keyed: the state default of [ANIM §10.2] applies). */
export const LOOK = Object.freeze({ inherit: 0, rim: 1, ball: 2, man: 3, target: 4, passer: 5, crowd: 6, none: 7, receiver: 8 });

/** Mask codes ([ANIM §2.3.3]). */
export const MASK = Object.freeze({ full: 0, upper: 1, arms: 2, armR: 3, armL: 4, legs: 5, face: 6 });
export const MASK_NAMES = Object.freeze(['full', 'upper', 'arms', 'armR', 'armL', 'legs', 'face']);
/** Root / pelvis-offset weight per mask code (last column of the mask table). */
export const MASK_ROOT = Float32Array.from([1, 0, 0, 0, 0, 1, 0]);

/** Per-bone mask weights, MASK_W[code][bone]. */
export const MASK_W = (() => {
  const groupOf = (i) => {
    const n = BONE_NAMES[i];
    if (n === 'Root') return 'root';
    if (n === 'pelvis') return 'pelvis';
    if (n === 'spine_01' || n === 'spine_02' || n === 'spine_03') return n;
    if (n === 'neck_01' || n === 'head') return 'neck';
    if (/^(thigh|calf|foot|ball)_/.test(n)) return 'legs';
    return 'arms'; // clavicles, arms, hands, fingers
  };
  //           pelvis s1    s2    s3    neck  arms  legs
  const table = {
    full: [1, 1, 1, 1, 1, 1, 1],
    upper: [0, 0.35, 0.75, 1, 1, 1, 0],
    arms: [0, 0, 0, 0.25, 0, 1, 0],
    armR: [0, 0, 0, 0.15, 0, 1, 0],
    armL: [0, 0, 0, 0.15, 0, 1, 0],
    legs: [1, 0.25, 0, 0, 0, 0, 1],
    face: [0, 0, 0, 0, 0, 0, 0],
  };
  const col = { pelvis: 0, spine_01: 1, spine_02: 2, spine_03: 3, neck: 4, arms: 5, legs: 6 };
  return MASK_NAMES.map((name) => {
    const w = new Float32Array(BONE_COUNT);
    for (let i = 0; i < BONE_COUNT; i++) {
      const g = groupOf(i);
      if (g === 'root') { w[i] = MASK_ROOT[MASK[name]]; continue; }
      let v = table[name][col[g]];
      // armR / armL: "that side only" for clavicles, arms, hands, fingers
      if (g === 'arms' && ((name === 'armR' && BONE_SIDE[i] > 0) || (name === 'armL' && BONE_SIDE[i] < 0))) v = 0;
      w[i] = v;
    }
    return w;
  });
})();

/** Mask name → code (unknown names throw, so typos in clip data fail at load). */
export function maskCode(name) {
  const c = MASK[name];
  if (c === undefined) throw new Error(`pose: unknown mask '${name}'`);
  return c;
}

/** One layer's pose. */
export class Pose {
  constructor() {
    this.q = new Float32Array(BONE_COUNT * 4);
    this.w = new Float32Array(BONE_COUNT);
    this.pel = new Float32Array(3);
    this.pelW = 0;                         // 1 when the pelvis offsets are defined by this pose
    this.root = new Float32Array(3);
    this.ball = new Uint8Array(1);         // BM code (0 = keep)
    this.bpath = new Float32Array(3);
    this.bpathOn = 0;
    this.fingers = new Float32Array(2);    // [right, left] dominant preset id, −1 none
    this.expr = new Float32Array(9);
    this.exprK = new Float32Array(9);      // 1 where the expression channel is keyed
    this.ftRL = new Float32Array(8);
    this.ftOn = new Uint8Array(2);
    this.look = new Float32Array(2);       // [LOOK code, weight]
    resetPose(this);
  }
}

/** Resets a pose to bind (identity quaternions), nothing tracked. */
export function resetPose(p) {
  const q = p.q;
  for (let i = 0; i < BONE_COUNT; i++) { q[i * 4] = 0; q[i * 4 + 1] = 0; q[i * 4 + 2] = 0; q[i * 4 + 3] = 1; p.w[i] = 0; }
  p.pel[0] = p.pel[1] = p.pel[2] = 0; p.pelW = 0;
  p.root[0] = p.root[1] = p.root[2] = 0;
  p.ball[0] = 0; p.bpath[0] = p.bpath[1] = p.bpath[2] = 0; p.bpathOn = 0;
  p.fingers[0] = -1; p.fingers[1] = -1;
  for (let i = 0; i < 9; i++) { p.expr[i] = 0; p.exprK[i] = 0; }
  for (let i = 0; i < 8; i++) p.ftRL[i] = 0;
  p.ftOn[0] = 0; p.ftOn[1] = 0;
  p.look[0] = 0; p.look[1] = 0;
  return p;
}

/** dst ← src (every field). */
export function copyPose(dst, src) {
  dst.q.set(src.q); dst.w.set(src.w); dst.pel.set(src.pel); dst.pelW = src.pelW; dst.root.set(src.root);
  dst.ball[0] = src.ball[0]; dst.bpath.set(src.bpath); dst.bpathOn = src.bpathOn;
  dst.fingers[0] = src.fingers[0]; dst.fingers[1] = src.fingers[1];
  dst.expr.set(src.expr); dst.exprK.set(src.exprK); dst.ftRL.set(src.ftRL);
  dst.ftOn[0] = src.ftOn[0]; dst.ftOn[1] = src.ftOn[1]; dst.look[0] = src.look[0]; dst.look[1] = src.look[1];
  return dst;
}

const FINGER_PROBE_R = BONE.index_01_r, FINGER_PROBE_L = BONE.index_01_l, LEG_PROBE = BONE.thigh_r;

/**
 * Override blend of pose b over pose a with layer weight w (0..1) and per-bone mask weights maskW
 * (Float32Array(53), e.g. MASK_W[code]); out may alias a. Per bone the effective weight is
 * k = w · maskW[bone] · b.w[bone] (untracked bones of b keep a). Quaternions nlerp on the short arc.
 * Discrete fields (ball mode, finger preset id, foot plants, look) switch to b's once its effective weight ≥ 0.5,
 * so a fade never shows a half-planted foot. Pelvis offsets / root use the mask's root column; expressions blend
 * only where b keys them.
 */
export function blendPose(out, a, b, w, maskW) {
  const aq = a.q, bq = b.q, oq = out.q;
  for (let i = 0; i < BONE_COUNT; i++) {
    const k = w * maskW[i] * b.w[i];
    const o = i * 4;
    if (k <= 0) {
      if (out !== a) { oq[o] = aq[o]; oq[o + 1] = aq[o + 1]; oq[o + 2] = aq[o + 2]; oq[o + 3] = aq[o + 3]; out.w[i] = a.w[i]; }
    } else if (k >= 1) {
      oq[o] = bq[o]; oq[o + 1] = bq[o + 1]; oq[o + 2] = bq[o + 2]; oq[o + 3] = bq[o + 3];
      out.w[i] = 1;
    } else {
      qnlerp(aq, o, bq, o, k, oq, o);
      const aw = a.w[i];
      out.w[i] = aw + (1 - aw) * k;
    }
  }
  const kr = w * maskW[0] * b.pelW;          // maskW[Root] carries the mask's root/pelvis-offset column
  for (let j = 0; j < 3; j++) {
    out.pel[j] = a.pel[j] + (b.pel[j] - a.pel[j]) * kr;
    out.root[j] = a.root[j] + (b.root[j] - a.root[j]) * w * maskW[0];
  }
  out.pelW = a.pelW + (1 - a.pelW) * kr;
  out.ball[0] = (w >= 0.5 && b.ball[0] !== 0) ? b.ball[0] : a.ball[0];
  if (w >= 0.5 && b.bpathOn) { out.bpath[0] = b.bpath[0]; out.bpath[1] = b.bpath[1]; out.bpath[2] = b.bpath[2]; out.bpathOn = 1; }
  else if (out !== a) { out.bpath.set(a.bpath); out.bpathOn = a.bpathOn; }
  const kfR = w * maskW[FINGER_PROBE_R] * b.w[FINGER_PROBE_R], kfL = w * maskW[FINGER_PROBE_L] * b.w[FINGER_PROBE_L];
  out.fingers[0] = kfR >= 0.5 && b.fingers[0] >= 0 ? b.fingers[0] : a.fingers[0];
  out.fingers[1] = kfL >= 0.5 && b.fingers[1] >= 0 ? b.fingers[1] : a.fingers[1];
  for (let j = 0; j < 9; j++) {
    const ke = w * b.exprK[j];
    out.expr[j] = a.expr[j] + (b.expr[j] - a.expr[j]) * ke;
    out.exprK[j] = a.exprK[j] > ke ? a.exprK[j] : ke;
  }
  const kl = w * maskW[LEG_PROBE];
  if (kl >= 0.5) {
    for (let s = 0; s < 2; s++) {
      out.ftOn[s] = b.ftOn[s];
      for (let j = 0; j < 4; j++) out.ftRL[s * 4 + j] = b.ftRL[s * 4 + j];
    }
  } else if (out !== a) {
    out.ftRL.set(a.ftRL); out.ftOn[0] = a.ftOn[0]; out.ftOn[1] = a.ftOn[1];
  }
  if (w >= 0.5 && b.look[0] !== 0) { out.look[0] = b.look[0]; out.look[1] = b.look[1]; }
  else if (out !== a) { out.look[0] = a.look[0]; out.look[1] = a.look[1]; }
  return out;
}

const _add = new Float32Array(4);
const _id = Float32Array.from([0, 0, 0, 1]);

/**
 * Additive layer: for every bone add tracks (add.w > 0), q ← nlerp(I, qAdd, w·add.w)·q (anatomical space, the
 * additive rotation is the outer factor); pelvis offsets add, expressions add (clamped to [0, 1]).
 */
export function addPose(out, add, w) {
  const q = out.q;
  for (let i = 0; i < BONE_COUNT; i++) {
    const k = w * add.w[i];
    if (k <= 0) continue;
    qnlerp(_id, 0, add.q, i * 4, k, _add, 0);
    qmul(_add, 0, q, i * 4, q, i * 4);
  }
  const kp = w * add.pelW;
  out.pel[0] += add.pel[0] * kp; out.pel[1] += add.pel[1] * kp; out.pel[2] += add.pel[2] * kp;
  for (let j = 0; j < 9; j++) {
    const v = out.expr[j] + add.expr[j] * w * add.exprK[j];
    out.expr[j] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}
