/**
 * presets.js — named channel data shared by clips, generators, locomotion and select.js (spec §4.6–§4.9,
 * [ANIM §2.7, §3.6, §3.8, §5.2, §5.5, §5.6, §9 shorthands]).
 *
 * Exports
 *   FINGER_PRESETS (names, index = preset id), FINGER_ID (name → id), FINGERS (curl/spread/thumb data per preset),
 *   FINGER_BONES (per hand: Int8Array(15) bone indices, order index/middle/ring/pinky _01.._03 then thumb _01.._03),
 *   fingerQuats(presetId, side, t, out, o) (15 anatomical quaternions; `curlTape` is animated by t),
 *   FINGER_Q (precomputed static preset quaternions), ARM / LEG (named channel arrays), SHORT (two-arm shorthands
 *   HIP_R, CHEST, CHIN, DOWN), SET/GUIDE/REL/FOLLOW(playerId) (form arm arrays), STANCE (§3.8 stances + per-player
 *   defensive stance), FORMS (per-player shooting / layup / dunk / tip numbers, §4.9), STYLE (§4.7), PLAYER_IDS, SLEG.
 *
 * Arm arrays are [flex, abd, int, elbow, pron, wFlex, wDev]; leg arrays [hip, abd, int, knee, ank, toe]; degrees.
 * Foot targets [x, z, yaw] in metres × sLeg. All numbers are the binding spec values; nothing here is tuned.
 */
import { anatQuat, AQ, BONE } from './rig.js';

/** Player ids in header order. */
export const PLAYER_IDS = Object.freeze(['kobe', 'jordan', 'lebron', 'giannis', 'yao', 'kyrie']);

/** sLeg per player (spec §4.1 table): authored metre offsets are multiplied by it at runtime. */
export const SLEG = Object.freeze({ kobe: 1.000, jordan: 0.999, lebron: 1.030, giannis: 1.108, yao: 1.171, kyrie: 0.941 });

// ---------------------------------------------------------------------------------------------------------------
// Finger presets ([ANIM §2.7]); curls _01/_02/_03 per finger, spread magnitudes on _01 (index +, ring/pinky −),
// thumb_01 [flex, abd, rot], thumb_02/_03 curls. Relative to the bind hand (already ≈ 15–20° curled).
// ---------------------------------------------------------------------------------------------------------------

/** Preset names; the array index is the preset id stored in clip finger tracks and Pose.fingers. */
export const FINGER_PRESETS = Object.freeze([
  'relax', 'grip', 'shoot', 'snap', 'spread', 'palmUp', 'fist', 'point', 'claw', 'shh', 'flat', 'curlTape',
]);
/** Preset name → id. */
export const FINGER_ID = Object.freeze(Object.fromEntries(FINGER_PRESETS.map((n, i) => [n, i])));

const f = (index, middle, ring, pinky, spread, thumb, thumbCurl) =>
  Object.freeze({ index, middle, ring, pinky, spread, thumb, thumbCurl });

/** Finger preset data ([ANIM §2.7] table). */
export const FINGERS = Object.freeze({
  relax: f([8, 10, 6], [10, 12, 8], [12, 14, 8], [14, 16, 10], [0, 0, 0, 0], [5, 5, 0], [5, 5]),
  grip: f([0, 8, 5], [0, 8, 5], [2, 8, 5], [4, 10, 6], [12, 0, 8, 16], [0, 40, 20], [5, 5]),
  shoot: f([-5, 5, 3], [-5, 5, 3], [-3, 6, 4], [0, 8, 5], [10, 0, 7, 14], [0, 50, 25], [0, 0]),
  snap: f([30, 40, 25], [35, 45, 25], [35, 45, 25], [30, 40, 25], [0, 0, 0, 0], [15, 20, 10], [15, 10]),
  spread: f([-8, 0, 0], [-8, 0, 0], [-8, 0, 0], [-8, 0, 0], [18, 0, 12, 25], [0, 60, 20], [-5, -5]),
  palmUp: f([0, 4, 2], [0, 4, 2], [0, 4, 2], [0, 4, 2], [10, 0, 8, 14], [0, 40, 10], [0, 0]),
  fist: f([85, 95, 70], [85, 95, 70], [85, 95, 70], [85, 95, 70], [0, 0, 0, 0], [40, 20, 30], [40, 30]),
  point: f([0, 0, 0], [85, 95, 70], [85, 95, 70], [85, 95, 70], [6, 0, 0, 0], [35, 15, 25], [35, 25]),
  claw: f([55, 60, 40], [55, 60, 40], [55, 60, 40], [55, 60, 40], [6, 0, 4, 8], [30, 10, 20], [30, 20]),
  shh: f([0, 0, 0], [85, 95, 70], [85, 95, 70], [85, 95, 70], [0, 0, 0, 0], [40, 10, 25], [40, 30]),
  flat: f([0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [4, 0, 3, 6], [0, 25, 0], [0, 0]),
  // Kobe's taped-finger flex: curl 0 → 60 → 0 at 0.8 Hz on the four fingers, 0.05 s stagger index → pinky;
  // phalanx ratio 1 : 1.12 : 0.82 (the fist's 85/95/70); thumb as relax.
  curlTape: Object.freeze({ animated: true, hz: 0.8, maxCurl: 60, stagger: 0.05, ratio: [1, 1.12, 0.82], base: 'relax' }),
});

const FINGER_NAMES = ['index', 'middle', 'ring', 'pinky'];
const SPREAD_SGN = [1, 0, -1, -1];

/** Finger bones per hand: FINGER_BONES.r / .l = Int8Array(15). */
export const FINGER_BONES = Object.freeze({
  r: Int8Array.from([...FINGER_NAMES.flatMap((n) => [1, 2, 3].map((k) => BONE[`${n}_0${k}_r`])), BONE.thumb_01_r, BONE.thumb_02_r, BONE.thumb_03_r]),
  l: Int8Array.from([...FINGER_NAMES.flatMap((n) => [1, 2, 3].map((k) => BONE[`${n}_0${k}_l`])), BONE.thumb_01_l, BONE.thumb_02_l, BONE.thumb_03_l]),
});

const _fch = new Float64Array(3);

/** Writes the 15 anatomical finger quaternions of preset data `d` for side (+1 left / −1 right) into out[o..o+60]. */
function writeFingerData(d, side, out, o, curlOverride) {
  for (let k = 0; k < 4; k++) {
    const curls = d[FINGER_NAMES[k]];
    for (let j = 0; j < 3; j++) {
      _fch[0] = curlOverride ? curlOverride[k * 3 + j] : curls[j];
      _fch[1] = j === 0 ? d.spread[k] * SPREAD_SGN[k] : 0;
      anatQuat(AQ.FINGER, side, _fch, out, o + (k * 3 + j) * 4);
    }
  }
  _fch[0] = d.thumb[0]; _fch[1] = d.thumb[1]; _fch[2] = d.thumb[2];
  anatQuat(AQ.THUMB1, side, _fch, out, o + 48);
  _fch[0] = d.thumbCurl[0]; anatQuat(AQ.THUMB, side, _fch, out, o + 52);
  _fch[0] = d.thumbCurl[1]; anatQuat(AQ.THUMB, side, _fch, out, o + 56);
}

/**
 * Precomputed static preset quaternions: FINGER_Q[((presetId·2 + sideIdx)·15 + k)·4], sideIdx 0 = right, 1 = left.
 * The animated `curlTape` slot holds its rest (relax) pose.
 */
export const FINGER_Q = (() => {
  const q = new Float32Array(FINGER_PRESETS.length * 2 * 60);
  for (let p = 0; p < FINGER_PRESETS.length; p++) {
    const d = FINGERS[FINGER_PRESETS[p]];
    const data = d.animated ? FINGERS[d.base] : d;
    writeFingerData(data, -1, q, (p * 2) * 60);
    writeFingerData(data, 1, q, (p * 2 + 1) * 60);
  }
  return q;
})();

const _tapeCurl = new Float64Array(12);
const CURL_TAPE = FINGER_ID.curlTape;

/**
 * Writes the 15 anatomical finger quaternions of preset `presetId` for hand `sideIdx` (0 right, 1 left) at time t
 * (s; only `curlTape` depends on it) into out[o..o+60]. Allocation free.
 */
export function fingerQuats(presetId, sideIdx, t, out, o) {
  if (presetId === CURL_TAPE) {
    const d = FINGERS.curlTape;
    for (let k = 0; k < 4; k++) {
      // c(t) = ½·max·(1 − cos 2π f (t − stagger·k)): 0 → max → 0 once per 1/f seconds
      const c = 0.5 * d.maxCurl * (1 - Math.cos(2 * Math.PI * d.hz * (t - d.stagger * k)));
      for (let j = 0; j < 3; j++) _tapeCurl[k * 3 + j] = c * d.ratio[j];
    }
    writeFingerData(FINGERS.relax, sideIdx === 0 ? -1 : 1, out, o, _tapeCurl);
    return out;
  }
  const src = ((presetId * 2) + sideIdx) * 60;
  for (let i = 0; i < 60; i++) out[o + i] = FINGER_Q[src + i];
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Named arm / leg arrays and the §9 shorthands
// ---------------------------------------------------------------------------------------------------------------

const A = (...v) => Object.freeze(v);

/** Named arm arrays [flex, abd, int, elbow, pron, wFlex, wDev]. */
export const ARM = Object.freeze({
  hang: A(0, 0, 0, 0, 0, 0, 0),
  DOWN: A(10, 12, 5, 25, 30, 0, 0),
  CHEST: A(35, 15, 30, 105, 20, -30, 0),
  HIP_R_R: A(20, 15, 25, 80, 30, -20, 0),
  HIP_R_L: A(35, 15, 45, 95, 10, -10, 0),
  CHIN_R: A(70, 8, 25, 125, 60, -40, 0),
  CHIN_L: A(65, 20, 35, 120, -10, -20, 0),
  chinned: A(55, 45, 35, 125, 15, -25, 0),          // postUp / power-drive jump stop / "chin it"
  chinItYao: A(55, 80, 35, 125, 15, -25, 0),        // rebound chin with elbows flared 80
  // dribble arm FK between contacts ([ANIM §4.1] table)
  dribStill: A(25, 15, 15, 65, 90, 10, 0),
  dribProtect: A(15, 25, 10, 55, 90, 15, 0),
  protectBar: A(60, 45, 40, 90, 20, 0, 0),
  dribJog: A(30, 14, 15, 70, 90, 10, 0),
  dribRun: A(35, 12, 15, 60, 90, 15, 0),
  dribSpeed: A(45, 10, 15, 45, 90, 20, 0),
  dribBackdown: A(10, 25, 10, 70, 90, 10, 0),
  backdownBar: A(45, 30, -10, 80, 40, 0, 0),
  // defence ([ANIM §6], spec §4.10, C22)
  backpedal: A(40, 30, 0, 60, 30, 0, 0),
  closeoutHand: A(150, 20, 0, 20, -40, 0, 0),
  closeoutOther: A(45, 35, 0, 40, 30, 0, 0),
  contestApex: A(172, 10, 0, 5, -30, 0, 0),
  contestOther: A(50, 40, 0, 45, 20, 0, 0),
  handUp: A(165, 12, 0, 10, -30, 0, 0),
  handUpOther: A(120, 30, 0, 30, 0, 0, 0),
  vertical: A(175, 5, 0, 0, -90, 0, 0),
  blockApex: A(165, 10, 0, 5, -20, -10, 0),
  blockOther: A(120, 30, 0, 30, 0, 0, 0),
  blockLoad: A(-15, 15, 0, 20, 0, 0, 0),
  reboundApex: A(170, 15, 0, 15, -60, -10, 0),
  reboundLoad: A(-20, 15, 0, 20, 0, 0, 0),
  stealStart: A(20, 25, 10, 25, 60, -30, 0),
  stealEnd: A(70, 25, 10, 20, 60, 30, 0),
  stealMiss: A(90, 20, 10, 10, 60, 40, 0),
  tipArm: A(175, 10, 0, 5, 0, -10, 0),
  tipOther: A(120, 25, 0, 30, 0, 0, 0),
  // catching ([ANIM §7.4])
  catchReady: A(60, 20, 0, 50, -60, 0, 0),
  catchHigh: A(140, 15, 0, 30, -60, 0, 0),
  catchLow: A(20, 15, 20, 40, -40, 0, 0),
  // passing ([ANIM §7.2])
  passWind: A(30, 20, 35, 115, 10, -40, 0),
  passChestRel: A(75, 10, 10, 15, 80, 40, 0),
  passChestFollow: A(80, 10, 5, 5, 95, 50, 0),
  passLobDip: A(60, 15, 20, 60, 0, -20, 0),
  passLobRel: A(125, 12, 10, 20, 40, 10, 0),
  passOverheadLoad: A(165, 15, 0, 70, 30, -30, 0),
  passOverheadRel: A(120, 10, 0, 0, 90, 30, 0),
  push1Load: A(40, 15, 10, 100, 90, -30, 0),
  push1Rel: A(80, 10, 0, 10, 90, 40, 0),
  // finishing
  layGuard: A(60, 30, 30, 60, 0, 0, 0),
  layCarry: A(140, 8, 15, 40, 60, -35, 0),
  layRelease: A(165, 8, 10, 10, 60, -20, 0),
  layFlick: A(160, 8, 10, 5, 60, 25, 0),
  fingerRollRel: A(160, 8, 10, 10, -70, 15, 0),
  powerShield: A(90, 60, 0, 20, -30, 0, 0),
  dunkCock2: A(178, 18, 0, 95, 30, -20, 0),
  dunkSlam2: A(150, 15, 0, 10, 90, 60, 0),
  dunkCock1: A(175, 25, -40, 110, 0, -40, 0),
  dunkSlam1: A(120, 10, 0, 5, 90, 70, 0),
  ballCupped: A(40, 20, 10, 110, -40, -30, 0),
  // crossed / falls
  flail: A(60, 60, 0, 30, 0, 0, 0),
  postBehind: A(-45, 25, 0, 10, -80, -70, 0),
});

/** Named leg arrays [hip, abd, int, knee, ank, toe]. */
export const LEG = Object.freeze({
  straight: A(0, 0, 0, 0, 0, 0),
  stand: A(3, 0, 0, 5, -2, 0),
  tripleThreat: A(23, 6, 5, 50, -15, 0),
  postUp: A(35, 8, 0, 45, -10, 0),
  postSeal: A(35, 10, 0, 45, -10, 0),
  boxOut: A(40, 12, 0, 55, -15, 0),
  def: A(40, 14, 0, 60, -12, 0),
  defYao: A(18, 8, 0, 25, -6, 0),
  shotStart: A(8, 4, 2, 12, -4, 0),
  takeoff: A(6, 4, 0, 8, 35, 0),
  airSet: A(10, 4, 0, 15, 30, 0),
  land: A(25, 6, 4, 40, -12, 0),
  layLand: A(25, 8, 0, 45, -10, 0),
  kneeDrive: A(95, 5, 0, 100, 30, 0),
  takeoffLeg: A(-10, 3, 0, 10, 40, 0),
  load: A(35, 10, 0, 45, -15, 0),
  contestAir: A(15, 6, 0, 25, 35, 0),
  contestLand: A(30, 10, 0, 45, -12, 0),
  blockLoad: A(40, 10, 0, 55, -18, 0),
  blockAir: A(20, 8, 0, 35, 35, 0),
  reboundLoad: A(45, 10, 0, 65, -20, 0),
  reboundAir: A(30, 8, 0, 45, 35, 0),
  reboundLand: A(35, 12, 0, 50, -15, 0),
  verticalAir: A(5, 4, 0, 8, 30, 0),
  dunkPlant: A(50, 8, 0, 85, -25, 0),
  dunkTakeoff: A(10, 6, 0, 15, 40, 0),
  dunkTuck: A(70, 10, 0, 110, 30, 0),
  dunkHang: A(60, 15, 0, 80, 20, 0),
  dunkLand: A(40, 10, 0, 60, -15, 0),
  knee90: A(0, 0, 0, 90, 0, 0),
});

/** Two-arm shorthands of [ANIM §9]: { RA, LA }. */
export const SHORT = Object.freeze({
  HIP_R: Object.freeze({ RA: ARM.HIP_R_R, LA: ARM.HIP_R_L }),
  CHEST: Object.freeze({ RA: ARM.CHEST, LA: ARM.CHEST }),
  CHIN: Object.freeze({ RA: ARM.CHIN_R, LA: ARM.CHIN_L }),
  DOWN: Object.freeze({ RA: ARM.DOWN, LA: ARM.DOWN }),
});

// ---------------------------------------------------------------------------------------------------------------
// Shooting forms (spec §4.9.2 / [ANIM §5.2]) + layup (§4.9.3) + dunk (§4.9.4) + tip ([ANIM §5.7]) numbers
// ---------------------------------------------------------------------------------------------------------------

const form = (o) => Object.freeze(o);

/**
 * FORMS[id]:
 *   takeoff {mid, three, pull, fade} (s from the press; fade null = no fade form), dip (m × sLeg), kneeDip (deg),
 *   ballAtDip, h {mid, three, pull, fade} (m), rva (s, launch − apex), setLead (s), set (RA at set), guide (LA at
 *   set), relFlex (shoulder flex at release), followWrist (wFlex), followHold (s; followHoldClutch for Jordan's
 *   clutch make), guideAfter {mode, cm}, fadeDrift (m), fadeLean (deg), forwardDrift (m, all jumpers; Giannis),
 *   airFade {R: [hip, knee], L: [hip, knee]}, head (N at set), face (expression weights during the shot),
 *   launchMid (expected ball-centre height at launch, mid-range, ±0.08),
 *   lay {h, gScale, to2, to1, vAir}, dunk {reach, h1, h2, slam1, slam2}, tipH.
 */
export const FORMS = Object.freeze({
  kobe: form({
    takeoff: { mid: 0.17, three: 0.21, pull: 0.22, fade: 0.21 }, dip: 0.10, kneeDip: 50, ballAtDip: 'waist',
    h: { mid: 0.50, three: 0.42, pull: 0.52, fade: 0.50 }, rva: -0.01, setLead: 0.08,
    set: A(115, 6, 18, 95, 85, -72, 0), guide: A(100, 12, 45, 100, 15, -20, 0), relFlex: 162, followWrist: 70,
    followHold: 0.45, followHoldClutch: 0.45, guideAfter: { mode: 'peel', cm: 10 }, fadeDrift: 0.45, fadeLean: 18,
    forwardDrift: 0, airFade: { R: [25, 40], L: [10, 25] }, head: A(-8, 0, 0), face: { scowl: 0.4 }, launchMid: 2.87,
    lay: { h: 0.60, gScale: 1, to2: 0.36, to1: 0.12, vAir: 2.6 },
    dunk: { reach: 2.51, h1: 0.73, h2: 0.79, slam1: 0.36, slam2: 0.37 }, tipH: 0.42,
  }),
  jordan: form({
    takeoff: { mid: 0.15, three: 0.19, pull: 0.19, fade: 0.19 }, dip: 0.11, kneeDip: 52, ballAtDip: 'waist',
    h: { mid: 0.55, three: 0.40, pull: 0.55, fade: 0.60 }, rva: 0.00, setLead: 0.08,
    set: A(118, 7, 18, 92, 85, -70, 0), guide: A(102, 14, 40, 98, 10, -15, 0), relFlex: 160, followWrist: 88,
    followHold: 0.45, followHoldClutch: 1.0, guideAfter: { mode: 'open', cm: 15 }, fadeDrift: 0.55, fadeLean: 15,
    forwardDrift: 0, airFade: { R: [42, 65], L: [5, 10] }, head: A(-4, 0, 0), face: {}, launchMid: 2.89,
    lay: { h: 0.70, gScale: 0.80, to2: 0.35, to1: 0.12, vAir: 2.6 },
    dunk: { reach: 2.50, h1: 0.74, h2: 0.80, slam1: 0.36, slam2: 0.37 }, tipH: 0.45,
  }),
  lebron: form({
    takeoff: { mid: 0.26, three: 0.30, pull: 0.31, fade: 0.30 }, dip: 0.12, kneeDip: 50, ballAtDip: 'hip',
    h: { mid: 0.30, three: 0.20, pull: 0.38, fade: 0.40 }, rva: -0.04, setLead: 0.08,
    set: A(110, 13, 14, 90, 80, -70, 0), guide: A(98, 16, 40, 96, 25, -15, 0), relFlex: 152, followWrist: 60,
    followHold: 0.30, followHoldClutch: 0.30, guideAfter: { mode: 'clean', cm: 0 }, fadeDrift: 0.45, fadeLean: 15,
    forwardDrift: 0, airFade: { R: [30, 30], L: [10, 15] }, head: A(-3, 0, 0), face: {}, launchMid: 2.66,
    lay: { h: 0.60, gScale: 1, to2: 0.37, to1: 0.12, vAir: 2.6 },
    dunk: { reach: 2.57, h1: 0.67, h2: 0.73, slam1: 0.34, slam2: 0.36 }, tipH: 0.42,
  }),
  giannis: form({
    takeoff: { mid: 0.36, three: 0.42, pull: 0.40, fade: null }, dip: 0.09, kneeDip: 40, ballAtDip: 'belt',
    h: { mid: 0.25, three: 0.12, pull: 0.25, fade: null }, rva: -0.07, setLead: 0.14,
    set: A(100, 18, 10, 98, 80, -65, 0), guide: A(92, 18, 35, 100, 10, -20, 0), relFlex: 156, followWrist: 60,   // relFlex spec 145: on the baked rig 145 launches the ball 0.07–0.09 m under the §4.9.2 2.65 (B46)
    followHold: 0.40, followHoldClutch: 0.40, guideAfter: { mode: 'pop', cm: 0 }, fadeDrift: 0, fadeLean: 0,
    forwardDrift: 0.15, airFade: { R: [15, 20], L: [15, 20] }, head: A(0, 0, 0), face: {}, launchMid: 2.65,
    lay: { h: 0.65, gScale: 1, to2: 0.38, to1: 0.13, vAir: 2.6 },
    dunk: { reach: 2.66, h1: 0.58, h2: 0.64, slam1: 0.31, slam2: 0.33 }, tipH: 0.40,
  }),
  yao: form({
    takeoff: { mid: 0.32, three: 0.36, pull: 0.38, fade: 0.36 }, dip: 0.05, kneeDip: 30, ballAtDip: 'chest',
    h: { mid: 0.18, three: 0.12, pull: 0.20, fade: 0.28 }, rva: -0.02, setLead: 0.10,
    set: A(118, 8, 16, 95, 85, -77, 0), guide: A(104, 10, 45, 100, 15, -20, 0), relFlex: 168, followWrist: 75,
    followHold: 0.60, followHoldClutch: 0.60, guideAfter: { mode: 'mirror', cm: 0 }, fadeDrift: 0.35, fadeLean: 12,
    forwardDrift: 0, airFade: { R: [15, 15], L: [15, 15] }, head: A(-2, 0, 0), face: {}, launchMid: 2.88,
    lay: { h: 0.30, gScale: 1, to2: 0.40, to1: 0.13, vAir: 1.8 },
    dunk: { reach: 2.82, h1: 0.42, h2: 0.48, slam1: 0.26, slam2: 0.28 }, tipH: 0.25,
  }),
  kyrie: form({
    takeoff: { mid: 0.17, three: 0.20, pull: 0.21, fade: 0.21 }, dip: 0.08, kneeDip: 48, ballAtDip: 'belly',
    h: { mid: 0.35, three: 0.30, pull: 0.40, fade: 0.40 }, rva: -0.01, setLead: 0.07,
    set: A(120, 4, 22, 98, 85, -72, 0), guide: A(104, 10, 45, 100, 15, -20, 0), relFlex: 160, followWrist: 70,
    followHold: 0.40, followHoldClutch: 0.40, guideAfter: { mode: 'up', cm: 10 }, fadeDrift: 0.10, fadeLean: 8,
    forwardDrift: 0, airFade: { R: [10, 20], L: [10, 20] }, head: A(-3, 0, 0), face: {}, launchMid: 2.59,
    lay: { h: 0.55, gScale: 1, to2: 0.33, to1: 0.11, vAir: 2.6 },
    dunk: { reach: 2.37, h1: 0.87, h2: 0.93, slam1: 0.39, slam2: 0.41 }, tipH: 0.40,
  }),
});

/** Form arm arrays of [ANIM §9]: SET(p) = set RA, GUIDE(p) = guide LA, REL(p), FOLLOW(p). */
export function SET(p) { return FORMS[p].set; }
export function GUIDE(p) { return FORMS[p].guide; }
const REL_CACHE = {}, FOLLOW_CACHE = {};
export function REL(p) { return REL_CACHE[p] || (REL_CACHE[p] = A(FORMS[p].relFlex, 4, 15, 5, 90, -15, 0)); }
export function FOLLOW(p) {
  return FOLLOW_CACHE[p] || (FOLLOW_CACHE[p] = A(FORMS[p].relFlex - 3, 4, 15, 0, 95, FORMS[p].followWrist, 0));
}

/** Dip arm pairs by "ball at dip" ([ANIM §5.3]); chest/belly keep the 0.00 arms. */
export const DIP_ARMS = Object.freeze({
  waist: Object.freeze({ RA: A(20, 12, 25, 95, 40, -25, 0), LA: A(25, 15, 35, 100, 10, -15, 0) }),
  hip: Object.freeze({ RA: A(15, 15, 25, 85, 40, -25, 0), LA: A(20, 15, 40, 95, 10, -15, 0) }),
  belt: Object.freeze({ RA: A(10, 12, 25, 85, 40, -20, 0), LA: A(15, 15, 35, 90, 10, -15, 0) }),
  chest: Object.freeze({ RA: A(35, 15, 30, 105, 20, -30, 0), LA: A(35, 15, 30, 105, 20, -30, 0) }),
  belly: Object.freeze({ RA: A(35, 15, 30, 105, 20, -30, 0), LA: A(35, 15, 30, 105, 20, -30, 0) }),
});

// ---------------------------------------------------------------------------------------------------------------
// Stances ([ANIM §3.8]); feet [x, z, yaw] × sLeg, toe-locked where noted
// ---------------------------------------------------------------------------------------------------------------

const st = (o) => Object.freeze(o);

/** Stationary base poses. STANCE.def[playerId | 'default'] are the per-player defensive stances. */
export const STANCE = Object.freeze({
  stand: st({ P: A(0, -0.01, 0, 3, 0, 0), S: A(2, 0, 0), N: A(0, 0, 0), RA: A(5, 10, 0, 12, 0, 0, 0), LA: A(5, 10, 0, 12, 0, 0, 0),
    RL: LEG.stand, LL: LEG.stand, Rft: A(-0.17, 0.00, -5, 'f'), Lft: A(0.17, 0.00, 5, 'f'), F: 'relax' }),
  tripleThreat: st({ P: A(0, -0.105, 0, 12, 0, 0), S: A(18, 0, 0), N: A(-22, 0, 0), RA: A(15, 18, 20, 75, 40, -25, 0),
    LA: A(40, 5, 60, 85, 0, -15, 0), RL: LEG.tripleThreat, LL: LEG.tripleThreat, Rft: A(-0.29, 0.04, 8, 'f'),
    Lft: A(0.29, -0.03, 8, 'f'), B: 'both', F: 'grip' }),
  postUp: st({ P: A(0, -0.12, 0, 8, 0, 0), S: A(10, 0, 0), N: A(-15, 30, 0), RA: ARM.chinned, LA: ARM.chinned,
    RL: LEG.postUp, LL: LEG.postUp, Rft: A(-0.38, 0, 0, 'f'), Lft: A(0.37, 0, 0, 'f'), B: 'both', F: 'grip' }),
  postSeal: st({ P: A(0, -0.12, 0, 8, 0, 0), S: A(10, 0, 0), N: A(-10, -35, 0), LA: A(60, 20, -20, 95, 60, 0, 0),
    RA: A(150, 20, 0, 30, -60, -30, 0), RF: 'palmUp', RL: LEG.postSeal, LL: LEG.postSeal,
    Rft: A(-0.42, 0, 0, 'f'), Lft: A(0.42, 0, 0, 'f'), F: 'relax' }),
  boxOut: st({ P: A(0, -0.16, -0.06, 20, 0, 0), S: A(12, 0, 0), N: A(-25, 0, 0), RA: A(20, 90, -30, 90, -40, 0, 0),
    LA: A(20, 90, -30, 90, -40, 0, 0), RL: LEG.boxOut, LL: LEG.boxOut, Rft: A(-0.42, 0, 0, 'f'), Lft: A(0.42, 0, 0, 'f'),
    F: 'spread' }),
  def: Object.freeze({
    default: st({ width: 0.75, P: A(0, -0.17, 0, 15, 0, 0), S: A(15, 0, 0), N: A(-25, 0, 0), RA: A(45, 30, 0, 30, 60, 0, 0), LA: A(100, 55, 0, 35, -20, 0, 0), legs: LEG.def }),
    kobe: st({ width: 0.85, P: A(0, -0.24, 0, 18, 0, 0), S: A(14, 0, 0), N: A(-28, 0, 0), RA: A(70, 75, 0, 25, -30, 0, 0), LA: A(70, 75, 0, 25, -30, 0, 0), legs: LEG.def, buzz: { hz: 4, ank: 5 } }),
    jordan: st({ width: 0.80, P: A(0, -0.25, 0, 18, 0, 0), S: A(12, 0, 0), N: A(-26, 0, 0), RA: A(40, 25, 0, 30, 60, 0, 0), LA: A(110, 50, 0, 35, -20, 0, 0), legs: LEG.def }),
    lebron: st({ width: 0.78, P: A(0, -0.16, 0, 12, 0, 0), S: A(10, 0, 0), N: A(-18, 0, 0), RA: A(55, 45, 0, 35, 20, 0, 0), LA: A(55, 45, 0, 35, 20, 0, 0), legs: LEG.def }),
    giannis: st({ width: 0.90, P: A(0, -0.22, 0, 15, 0, 0), S: A(12, 0, 0), N: A(-22, 0, 0), RA: A(85, 85, 0, 15, -40, 0, 0), LA: A(85, 85, 0, 15, -40, 0, 0), RF: 'spread', LF: 'spread', legs: LEG.def }),
    yao: st({ width: 0.70, P: A(0, -0.07, 0, 6, 0, 0), S: A(6, 0, 0), N: A(-8, 0, 0), RA: A(45, 45, 0, 60, -30, 0, 0), LA: A(45, 45, 0, 60, -30, 0, 0), legs: LEG.defYao }),
    kyrie: st({ width: 0.70, P: A(0, -0.18, 0, 15, 0, 0), S: A(14, 0, 0), N: A(-24, 0, 0), RA: A(40, 35, 0, 35, 60, 0, 0), LA: A(40, 35, 0, 35, 60, 0, 0), legs: LEG.def, activeHands: { hz: 2, flex: 10 } }),
  }),
});

/** Defensive stance feet for width w (m, × sLeg): R [−w/2, 0.03, −10], L [w/2, −0.03, 10], toe-locked, ank +8. */
export function defFeet(w) { return { Rft: [-w / 2, 0.03, -10, 't'], Lft: [w / 2, -0.03, 10, 't'], ank: 8 }; }

// ---------------------------------------------------------------------------------------------------------------
// STYLE (spec §4.7 / [ANIM §3.6])
// ---------------------------------------------------------------------------------------------------------------

const sty = (o) => Object.freeze(o);

/**
 * STYLE[id]: tempo (non-air action segments; > 1 slower), stride ×, leanAdd (deg), armSwing ×, elbowAdd, abdAdd,
 * bob ×, sway (spine roll amp deg), headCarry (neck pitch add), slide (dc ×), turnRate (informational, C21),
 * toeBounce {hz, ank} | null, dribble {yTop, f, push} multipliers.
 */
export const STYLE = Object.freeze({
  kobe: sty({ tempo: 1.00, stride: 1.00, leanAdd: 0, armSwing: 1.00, elbowAdd: 0, abdAdd: 0, bob: 1.00, sway: 1.5, headCarry: 5, slide: 1.00, turnRate: 12, toeBounce: null, dribble: { yTop: 1, f: 1, push: 1 } }),
  jordan: sty({ tempo: 0.97, stride: 1.00, leanAdd: 1, armSwing: 1.05, elbowAdd: 0, abdAdd: 0, bob: 1.00, sway: 1.5, headCarry: 0, slide: 1.05, turnRate: 12.5, toeBounce: null, dribble: { yTop: 1, f: 1, push: 1 } }),
  lebron: sty({ tempo: 1.02, stride: 1.00, leanAdd: 2, armSwing: 1.10, elbowAdd: 0, abdAdd: 4, bob: 0.90, sway: 2.0, headCarry: -3, slide: 0.95, turnRate: 11, toeBounce: null, dribble: { yTop: 0.95, f: 1, push: 1.15 } }),
  giannis: sty({ tempo: 1.05, stride: 1.06, leanAdd: 1, armSwing: 1.05, elbowAdd: 0, abdAdd: 2, bob: 1.10, sway: 2.0, headCarry: 0, slide: 1.10, turnRate: 11, toeBounce: { hz: 2.0, ank: 4 }, dribble: { yTop: 1, f: 0.95, push: 1.3 } }),
  yao: sty({ tempo: 1.12, stride: 0.92, leanAdd: -4, armSwing: 0.65, elbowAdd: 10, abdAdd: 8, bob: 0.80, sway: 4.0, headCarry: 0, slide: 0.80, turnRate: 8, toeBounce: null, dribble: { yTop: 1.15, f: 0.85, push: 0.9 } }),
  kyrie: sty({ tempo: 0.92, stride: 0.96, leanAdd: 1, armSwing: 0.95, elbowAdd: -5, abdAdd: 0, bob: 1.25, sway: 1.5, headCarry: 0, slide: 1.00, turnRate: 14, toeBounce: { hz: 1.6, ank: 3 }, dribble: { yTop: 0.90, f: 1.10, push: 1 } }),
});
