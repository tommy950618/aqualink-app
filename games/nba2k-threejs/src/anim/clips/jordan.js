/**
 * clips/jordan.js — Michael Jordan's signature clips, celebrations and idle habits (spec §4.11, §4.12, C10, C12,
 * [ANIM §9.2 J1–J7, §8.2, §8.3]).
 *
 * Exports
 *   JORDAN_CLIPS  normalised ClipDefs (shared registrations; times final, tempo false):
 *     sig.jordan.turnFade, sig.jordan.ftDunk, sig.jordan.theMove, sig.jordan.cradle, sig.jordan.jab,
 *     sig.jordan.jabShot, sig.jordan.ripDrive, sig.jordan.pullup, sig.jordan.steal,
 *     cel.jordan.shrug, cel.jordan.leapPump, cel.jordan.fistJog, cel.jordan.pointSmirk, cel.jordan.lastShot,
 *     idle.jordan.shortsGrip, idle.jordan.soleWipe, idle.jordan.clap, idle.jordan.palmsFloor
 *
 * Faces: tongue out from the gather to the landing (+0.10) on every layup / dunk, tongue in on jump shots
 * ([ANIM §8.1]). Times reproduce select.js: turnFade takeoff 0.68 / set 0.80 / release 1.036 / land 1.39; FT-line dunk
 * takeoff 0.48, slam (descending, gravity × 0.70) 1.184, land 1.559; the move release 0.84 descending; cradle slam
 * 0.55, rim 0.58–0.71, land 1.15. Plant positions of the approach clips follow the root curve.
 */
import { defineClip } from '../clip.js';
import { SET, REL, FOLLOW, SHORT, LEG, STANCE } from '../presets.js';
import { th, jumpTail, rootAt, makeJumper, makeSteal, faceKeysJordan, guideSet, SLAM1, HAMMER1, GRIP2, RIP_LOW, RIP_HIP_L, defineJump } from './shots.js';

const TONGUE_IN = { tongueOut: 0 };

// ---------------------------------------------------------------------------------------------------------------
// J1 turnaround fadeaway (left mid-post / baseline; left-foot pivot ≈ 180° over the right shoulder, scissor kick)
// ---------------------------------------------------------------------------------------------------------------
const POST0 = { P: [0, -0.12, 0, 12, 0, 0], S: [20, 0, 0], N: [-20, -30, 0], RA: GRIP2.chinOut, LA: GRIP2.chinOut };
const turnFade = defineClip({
  id: 'sig.jordan.turnFade', dur: 1.75, mask: 'full', root: 'motion', entry: 'stop', entryDecel: 20, tempo: false, jump: { h: 0.62 }, hand: 'R',
  cancel: 1.49, blendIn: 0.06, blendOut: 0.20, target: 'takeoff',
  params: { cat: 'jumper', meterFrom: 0.45, tIdeal: 0.986, METER_T: 0.67, baseSide: 'L' },
  keys: [
    [0.00, { ...POST0, RL: [35, 8, 0, 45, -10, 0], LL: [35, 8, 0, 45, -10, 0], Rft: [-0.28, 0, 0, 'f'], Lft: [0.27, 0, 0, 't'], B: 'both', RF: 'grip', LF: 'grip',
      look: 'none', R: [0, 0, 0], E: TONGUE_IN }],
    // he checks the defender: ball ripped up 10°, head turns further over the right shoulder (D-ANIM-8 first motion)
    [0.05, { RA: [60, 28, 40, 120, 20, -25, 0], LA: [60, 28, 40, 120, 20, -25, 0], N: [-22, -40, 0] }],
    [0.20, { ...POST0 }],
    // shoulder fake 15° to the middle, head stays toward the baseline, ball 10 cm left
    [0.27, { P: [null, null, null, null, 15, null], S: [null, 15, null], N: [-20, -30, 0], RA: [50, 23, 45, 120, 20, -25, 0], LA: [50, 33, 35, 120, 20, -25, 0] }],
    [0.33, { P: [null, null, null, null, 0, null], S: [null, 0, null], Rft: null, RL: [30, 25, 0, 60, 10, 0], R: [0, 0, 0], ...POST0 }],
    [0.45, { R: [0.40, 0.02, -90], P: [0, -0.15, 0, 10, -15, 0], ...SHORT.CHIN, N: [-15, 0, 0], look: 'rim' }],
    [0.60, { R: [0.52, 0, -180], Lft: [0.27, 0, -180, 't'], Rft: [0.77, 0, -180, 'f'], P: [0, -0.17, 0, 10, 0, 0], S: [8, 0, 0], RL: [45, 6, 0, 62, -18, 0],
      LL: [45, 6, 0, 62, -18, 0], ev: ['plantR', 'gather'] }],
    [0.68, { P: [0, -0.04, 0, 0, 0, 0], S: [2, 0, 0], RL: [6, 4, 0, 8, 35, 0], LL: [6, 4, 0, 8, 35, 0], Rft: null, Lft: null, RA: [100, 8, 20, 110, 80, -55, 0], ev: 'takeoff' }],
    [0.80, { RA: SET('jordan'), LA: guideSet('jordan'), RF: 'shoot', P: [0, 0, 0, -8, 0, 0], S: [-7, 0, 0], N: [-4, 0, 0], ev: 'set' }],
    // the scissor kick: right knee up, left leg hangs straighter, toes down
    [0.88, { RL: [42, 5, 0, 65, 40, 0], LL: [5, 5, 0, 10, 30, 0] }],
    [0.68 + th(0.62), { ev: 'apex' }],
    [1.036, { RA: REL('jordan'), LA: [107, 29, 25, 78, -10, 0, 0], B: 'free', P: [null, null, null, -8, 0, 0], S: [-7, 0, 0], ev: 'release' }],
    [1.14, { RA: FOLLOW('jordan'), RF: 'snap', LA: [90, 20, 0, 20, 0, 0, 0] }],
    [1.39, { RL: [30, 6, 4, 30, -10, 0], LL: [30, 6, 4, 30, -10, 0], Rft: [0.70, 0.55, -180, 'f'], Lft: [0.34, 0.55, -180, 'f'], R: [0.52, 0.55, -180],
      P: [0, -0.08, 0, 6, 0, 0], S: [4, 0, 0], ev: 'land' }],
    [1.49, { RA: [155, 4, 15, 0, 95, 85, 0] }],
    [1.75, { P: [0, -0.03, 0, 4, 0, 0], S: [4, 0, 0], N: [0, 0, 0], ...SHORT.DOWN, RF: 'relax', LF: 'relax' }],
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// J2 free-throw-line dunk (C10): h 1.00, gravity × 0.70, slam descending at takeoff + 0.704, air 1.08 s
// ---------------------------------------------------------------------------------------------------------------
const FT = { TO: 0.48, h: 1.00, g: 0.70, slam: 1.184 };
FT.land = FT.TO + 2 * th(FT.h, FT.g);
const ftRk = [[0, { R: [0, 0, 0] }], [0.48, { R: [0, 2.40 / 0.999, 0] }], [1.184, { R: [0, 6.45 / 0.999, 0] }]];
const ftDunk = defineJump({
  id: 'sig.jordan.ftDunk', dur: 2.00, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h: 1.00, gScale: 0.70, descending: true },
  meter: false, hand: 'R', cancel: 1.70, blendIn: 0.10, blendOut: 0.25, target: 'takeoff',
  params: { cat: 'dunk', hands: 1, gatherWindow: [6.0, 7.6], dTO: 4.4, toDist: 2.40, slowmo: 0.35 },
  keys: [
    ...ftRk,
    // gather 2–3 m before the line: long stride, ball pulled into both hands at the right hip
    [0.00, { B: 'both', ...SHORT.HIP_R, RF: 'grip', LF: 'grip', P: [0, -0.10, 0, 8, 0, 0], S: [10, 0, 0], N: [-12, 0, 0], Lft: null, Rft: null,
      RL: [40, 6, 0, 55, 10, 0], LL: [-10, 4, 0, 30, 30, 0], look: 'rim', ev: 'gather' }],
    // long penultimate RIGHT step, lean back 10° to convert speed
    [0.14, { Rft: [-0.12, rootAt(ftRk, 0.14)[1] + 0.30, 0, 'f'], P: [0, -0.15, 0, -10, 0, 0], S: [-5, 0, 0], RL: [35, 5, 0, 50, -10, 0], LL: [20, 5, 0, 60, 20, 0], ev: 'plantR' }],
    [0.28, { Rft: null, RL: [60, 5, 0, 80, 20, 0] }],
    // plant at the line: right thigh to horizontal, ball to the chest
    [0.42, { Lft: [0.12, rootAt(ftRk, 0.42)[1] + 0.30, 0, 'f'], LL: [20, 4, 0, 60, -10, 0], RL: [90, 5, 0, 80, 20, 0], ...SHORT.CHEST, ev: 'plantL' }],
    [0.48, { Lft: null, LL: [-10, 4, 0, 10, 45, 0], RL: [90, 5, 0, 85, 25, 0], P: [0, -0.03, 0, 0, 0, 0], S: [2, 0, 0], ev: 'takeoff' }],
    [0.60, { ev: 'slowmoIn' }],
    // the scissor silhouette: take-off leg trails nearly straight, toe pointed; knee at hip height
    [0.65, { LL: [-25, 5, 0, 10, 45, 0], RL: [90, 5, 0, 90, 30, 0] }],
    // double clutch: ball down to the waist, both hands
    [0.77, { RA: [30, 20, 20, 90, 40, -20, 0], LA: [30, 20, 20, 90, 40, -20, 0] }],
    // the right hand alone sweeps it back
    [0.90, { B: 'R', RA: [-20, 25, 10, 60, 30, -10, 0], LA: [100, 20, 0, 20, 0, 0, 0], LF: 'relax' }],
    [0.48 + th(1.00, 0.70), { ev: 'apex' }],
    // cocked behind the right ear, left arm toward the rim, right leg extends forward
    [1.07, { RA: [170, 25, -30, 90, 0, -40, 0], LA: [130, 20, 0, 20, -20, 0, 0], S: [-15, 0, 0], N: [-15, 0, 0], RL: [70, 5, 0, 30, 30, 0] }],
    // tomahawk: shoulder 170 → 130, elbow extends, wrist snaps; legs come together
    [1.14, { RA: [175, 15, 0, 25, 40, -45, 0], S: [-6, 0, -8] }],
    [1.184, { ...SLAM1, B: 'free', RL: [20, 4, 0, 30, 30, 0], LL: [20, 4, 0, 30, 30, 0], ev: ['slam', 'slowmoOut'] }],
    [1.25, { RA: [130, 10, 0, 5, 90, 70, 0], S: [10, 0, 0], RC: [0, 0] }],
    [1.34, { RA: [120, 12, 0, 20, 80, 40, 0], LA: [90, 25, 0, 30, 0, 0, 0] }],
    [FT.land, { RL: [50, 10, 0, 60, -15, 0], LL: [50, 10, 0, 60, -15, 0], Rft: [-0.25, 6.55, 0, 'f'], Lft: [0.25, 6.55, 0, 'f'], P: [0, -0.16, 0, 14, 0, 0],
      S: [10, 0, 0], RA: [60, 25, 0, 50, 30, 0, 0], LA: [60, 25, 0, 50, 30, 0, 0], ev: 'land' }],
    [2.00, { P: [0, -0.06, 0, 8, 0, 0], S: [8, 0, 0], N: [0, 0, 0], ...SHORT.DOWN }],
    ...faceKeysJordan(0, FT.land, 2.00),
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// J3 "the move": mid-air hand switch to a left-hand reverse-side finish off the glass (h 0.95, release descending)
// ---------------------------------------------------------------------------------------------------------------
const mvRk = [[0, { R: [0, 0, 0] }], [0.12, { R: [0, 0.50 / 0.999, 0] }], [1.00, { R: [0, 2.05 / 0.999, 0] }]];
const theMove = defineJump({
  id: 'sig.jordan.theMove', dur: 1.25, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h: 0.95 }, meter: 'key', hand: 'R',
  cancel: 1.10, blendIn: 0.08, blendOut: 0.20, target: 'takeoff',
  params: { cat: 'layup', meterFrom: 0.30, tIdeal: 0.79, METER_T: 0.61, gatherWindow: [2.0, 4.6], exitV: [0, 3], dTO: 2.0 },
  keys: [
    ...mvRk,
    [0.00, { B: 'R', RA: [45, 20, 10, 110, -40, -30, 0], LA: [40, 15, 40, 95, 0, -15, 0], RF: 'grip', LF: 'relax', Lft: [0.08, 0.30, 0, 'f'], Rft: null,
      P: [0, -0.14, 0, 8, 0, 0], S: [8, 0, 0], N: [-12, 0, 0], RL: [50, 5, 0, 85, 20, 0], LL: [25, 5, 0, 40, -15, 0], look: 'rim', ev: ['gather', 'plantL'] }],
    // takeoff as if to dunk
    [0.12, { Lft: null, LL: LEG.takeoff, RL: [70, 5, 0, 90, 30, 0], RA: [160, 15, 0, 40, -20, -30, 0], LA: [100, 20, 20, 60, 0, 0, 0], B: 'R', LF: 'relax',
      P: [0, -0.03, 0, 2, 0, 0], ev: 'takeoff' }],
    [0.22, { RL: [40, 8, 0, 60, 30, 0], LL: [40, 8, 0, 60, 30, 0] }],
    [0.39, { RA: [150, 15, 10, 60, 0, -30, 0] }],
    [0.12 + th(0.95), { ev: 'apex' }],
    // ball to the belly, piked 20°, knees tucked
    [0.59, { RA: [30, 10, 40, 110, 60, -10, 0], S: [20, 0, 0], RL: [70, 10, 0, 70, 30, 0], LL: [70, 10, 0, 70, 30, 0], LA: [40, 10, 40, 100, -40, 0, 0] }],
    // hand switch in front of the belly; right arm up and out to shield
    [0.66, { LA: [40, 10, 40, 100, -60, 0, 0], B: 'L', LF: 'grip', RF: 'relax', RA: [90, 60, 0, 90, 0, 0, 0] }],
    // left arm out and up, side-bend 15° left, head up-left
    [0.79, { LA: [130, 110, 0, 20, -40, 0, 0], S: [10, 0, 15], N: [-25, 30, 0] }],
    // wrist flick with English: off the glass
    [0.84, { LA: [140, 110, 0, 10, -40, 35, 10], B: 'free', LF: 'snap', ev: 'release' }],
    [0.92, { RL: [30, 8, 0, 40, 30, 0], LL: [30, 8, 0, 40, 30, 0], LA: [130, 100, 0, 15, -40, 30, 0] }],
    [1.00, { RL: LEG.layLand, LL: LEG.layLand, Rft: [-0.18, 2.12, 0, 'f'], Lft: [0.18, 2.12, 0, 'f'], P: [0, -0.10, 0, 10, 0, 0], S: [8, 0, 0], N: [-5, 0, 0], ev: 'land' }],
    [1.25, { ...SHORT.DOWN, LF: 'relax', P: [0, -0.06, 0, 10, 0, 0], S: [12, 0, 0] }],
    ...faceKeysJordan(0, 1.00, 1.25),
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// J4 rock-the-cradle breakaway dunk (h 1.00, slam 0.55, rim 0.58–0.71, land 1.15)
// ---------------------------------------------------------------------------------------------------------------
const crRk = [[0, { R: [0, 0, 0] }], [0.13, { R: [0, 0.40 / 0.999, 0] }], [0.55, { R: [0, 1.45 / 0.999, 0] }]];
const cradle = defineJump({
  id: 'sig.jordan.cradle', dur: 1.40, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h: 1.00, hang: 0.13 }, meter: false,
  hand: 'R', cancel: 1.25, blendIn: 0.10, blendOut: 0.25, target: 'takeoff',
  params: { cat: 'dunk', hands: 1, gatherWindow: [1.46, 2.14], dTO: 1.4, toDist: 0.40 },
  keys: [
    ...crRk,
    [0.00, { B: 'both', RA: [40, 20, 10, 115, -50, -30, 0], LA: [40, 15, 40, 95, 0, -15, 0], RF: 'grip', LF: 'grip', Lft: [0.10, 0.25, 0, 'f'], Rft: null,
      P: [0, -0.14, 0, 8, 0, 0], S: [8, 0, 0], N: [-12, 0, 0], RL: [50, 5, 0, 85, 20, 0], LL: [25, 5, 0, 40, -15, 0], look: 'rim', ev: ['gather', 'plantL'] }],
    [0.06, { B: 'R', LF: 'relax' }],
    // left arm out to the side for balance, held
    [0.13, { Lft: null, LL: LEG.takeoff, RL: [60, 5, 0, 80, 30, 0], LA: [60, 70, 0, 20, 0, 0, 0], P: [0, -0.03, 0, 2, 0, 0], ev: 'takeoff' }],
    // swing DOWN and BACK: ball beside the right hip
    [0.27, { RA: [-30, 15, 10, 20, -40, -30, 0], S: [10, 0, 0] }],
    [0.40, { RA: [90, 15, 0, 30, -30, -30, 0], RL: [70, 10, 0, 90, 30, 0], LL: [70, 10, 0, 90, 30, 0] }],
    // pendulum up, then thrown down with the wrist flexing 80
    [0.50, { RA: [175, 20, -20, 40, 0, -40, 0], S: [-8, 0, 0] }],
    [0.55, { ...SLAM1, B: 'free', ev: 'slam' }],
    [0.61, { RA: [140, 10, 0, 5, 90, 80, 0], S: [12, 0, 0], RC: [0, 0] }],
    [0.58, { RF: 'claw', RL: LEG.dunkHang, LL: LEG.dunkHang, ev: 'rimGrab' }],
    [0.13 + th(1.00), { ev: 'apex' }],
    [0.71, { RA: [140, 12, 0, 30, 60, 0, 0], RF: 'relax', ev: 'rimRelease' }],
    [1.15, { RL: LEG.dunkLand, LL: LEG.dunkLand, Rft: [-0.25, 1.55, 0, 'f'], Lft: [0.25, 1.55, 0, 'f'], P: [0, -0.15, 0, 14, 0, 0], S: [10, 0, 0],
      RA: [60, 25, 0, 50, 30, 0, 0], LA: [60, 25, 0, 50, 30, 0, 0], ev: 'land' }],
    [1.40, { P: [0, -0.06, 0, 6, 0, 0], S: [6, 0, 0], N: [0, 0, 0], ...SHORT.DOWN }],
    ...faceKeysJordan(0, 1.15, 1.40),
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// J5 jab (move) + jab shot (jumper) + rip drive (drive); weight 60 % on the left (pivot) foot
// ---------------------------------------------------------------------------------------------------------------
const JAB0 = { P: [0.04, -0.12, 0, 12, 0, 0], S: [22, 0, 0], N: [-20, 0, 0], ...SHORT.HIP_R, RL: STANCE.tripleThreat.RL, LL: [30, 6, 5, 55, -18, 0] };
const jab = defineClip({
  id: 'sig.jordan.jab', dur: 0.47, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.06, blendOut: 0.12,
  params: { cat: 'move' },
  keys: [
    [0.00, { ...JAB0, Rft: [-0.29, 0.04, 8, 'f'], Lft: [0.29, -0.03, 8, 't'], B: 'both', RF: 'grip', LF: 'grip', look: 'man', E: TONGUE_IN }],
    [0.10, { P: [0.06, -0.14, 0, 14, 0, 0], S: [24, 0, 0], N: [-24, 0, 0] }],
    [0.27, { Rft: null, RL: [35, 6, 0, 55, 10, 0] }],
    // hard short jab 0.35 toward the defender's left hip; head and shoulders dip 10 cm; ball low across to the left knee
    [0.40, { Rft: [-0.45, 0.36, 20, 't'], RL: [30, 10, 10, 40, -5, 0], P: [0.04, -0.22, 0.04, 16, 0, 0], S: [30, 0, 0], N: [-28, 0, 0],
      ...RIP_LOW, ev: ['plantR', 'fake'] }],
    [0.47, { P: [0.04, -0.21, 0.04, 16, 0, 0] }],
  ],
});

const jsT = { TO: 0.13, apex: 0.13 + th(0.50), tSet: 0.32, tRel: 0.45, tLand: 0.13 + 2 * th(0.50), tEnd: 0.95 };
const jabShot = defineClip({
  id: 'sig.jordan.jabShot', dur: 0.95, mask: 'full', root: 'motion', entry: 'stop', entryDecel: 18, tempo: false, jump: { h: 0.50 }, hand: 'R',
  cancel: 0.87, blendIn: 0.06, blendOut: 0.20,
  params: { cat: 'jumper', meterFrom: 0, tIdeal: 0.40, METER_T: 0.50 },
  keys: [
    [0.00, { P: [0.04, -0.20, 0.03, 16, 0, 0], S: [26, 0, 0], N: [-24, 0, 0], ...RIP_LOW, Rft: null,
      Lft: [0.29, -0.03, 8, 'f'], RL: [30, 10, 10, 50, 10, 0], LL: [35, 6, 5, 60, -18, 0], B: 'both', RF: 'grip', LF: 'grip', look: 'rim', R: [0, 0, 0], E: TONGUE_IN }],
    // the right foot returns beside the left, ball to the chin
    [0.10, { Rft: [-0.29, 0.04, 8, 'f'], RL: [35, 6, 4, 55, -18, 0], ...SHORT.CHIN, P: [0, -0.12, 0, 8, 0, 0], S: [8, 0, 0], N: [-10, 0, 0] }],
    ...jumpTail('jordan', jsT, { R: [0, 0, 0], face: TONGUE_IN }),
  ],
});

const ripDrive = defineClip({
  id: 'sig.jordan.ripDrive', dur: 0.45, mask: 'full', root: 'motion', entry: 'replace', tempo: false, hand: 'R', blendIn: 0.06, blendOut: 0.12,
  params: { cat: 'move', exitV: [-0.5, 4.8] },
  keys: [
    [0.00, { P: [0.04, -0.20, 0.03, 16, 0, 0], S: [28, 0, 0], N: [-26, 0, 0], ...RIP_LOW, Rft: [-0.45, 0.36, 20, 't'],
      Lft: [0.29, -0.03, 8, 't'], RL: [30, 10, 10, 40, -5, 0], LL: [35, 6, 5, 60, -18, 0], B: 'both', RF: 'grip', LF: 'grip', R: [0, 0, 0], look: 'man', E: { tongueOut: 0.3 } }],
    [0.03, { Rft: null, RL: [40, 6, 0, 65, 15, 0] }],
    // rip low to the right hip, then the push dribble with a long right step
    [0.10, { ...RIP_HIP_L, S: [30, -10, 0] }],
    [0.18, { B: 'drib', RA: [45, 10, 15, 45, 90, 20, 0], LA: [30, 20, 0, 40, 10, 0, 0], LF: 'relax', Rft: [-0.55, 0.80, 0, 't'], RL: [40, 6, 0, 50, -10, 0], E: { tongueOut: 1 }, ev: 'plantR' }],
    [0.26, { Lft: null, LL: [-10, 5, 0, 40, 30, 0] }],
    [0.45, { P: [0, -0.12, 0, 16, 0, 0], S: [24, 0, 0], N: [-14, 0, 0], LL: [45, 5, 0, 70, 10, 0], R: [-0.30, 0.80, 0] }],
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// J6 pull-up (1-2 stop; h 0.55, release at the apex, knees together, drift 0.15 back) and J7 steal
// ---------------------------------------------------------------------------------------------------------------
const pullup = makeJumper('jordan', 'pull12', {
  id: 'sig.jordan.pullup', h: 0.55, drift: 0.15, air: { R: [10, 15], L: [10, 15] }, airAnk: 40, METER_T: 0.594,
});
const steal = makeSteal('jordan', 'sig.jordan.steal');

// ---------------------------------------------------------------------------------------------------------------
// Celebrations ([ANIM §8.2])
// ---------------------------------------------------------------------------------------------------------------
const LS = th(0.30);
const cels = [
  defineClip({
    id: 'cel.jordan.shrug', dur: 1.20, mask: 'full', root: 'motion', entry: 'replace', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.30,
    noRhythm: true, params: { cat: 'cel' },
    keys: [
      [0.00, { RC: [0, 0], LC: [0, 0], RA: [15, 15, 0, 30, 20, 0, 0], LA: [15, 15, 0, 30, 20, 0, 0], N: [0, 0, 0], R: [0, 0, 0], E: { smirk: 0 }, look: 'crowd' }],
      // turns toward the sideline: root yaw 30 over 0.30; palms up at the waist, shoulders up ≈ 8 cm
      [0.30, { R: [0, 0, 30] }],
      [0.35, { RC: [18, 0], LC: [18, 0], RA: [30, 35, -30, 80, -80, -20, 0], LA: [30, 35, -30, 80, -80, -20, 0], RF: 'palmUp', LF: 'palmUp', N: [0, 0, 10], E: { smirk: 0.7 } }],
      [0.90, { RC: [16, 0], LC: [16, 0], N: [0, 0, 10] }],
      [1.20, { RC: [0, 0], LC: [0, 0], RA: [10, 12, 5, 25, 30, 0, 0], LA: [10, 12, 5, 25, 30, 0, 0], RF: 'relax', LF: 'relax', N: [0, 0, 0], R: [0, 0, 30], E: { smirk: 0.5 } }],
    ],
  }),
  defineJump({
    id: 'cel.jordan.leapPump', dur: 1.40, mask: 'full', root: 'none', tempo: false, jump: { h: 0.30 }, hand: 'R', blendIn: 0.10, blendOut: 0.30,
    params: { cat: 'cel' },
    keys: [
      [0.00, { P: [0, -0.06, 0, 8, 0, 0], RA: [40, 20, 0, 90, 0, 0, 0], RL: [20, 6, 0, 30, -8, 0], LL: [20, 6, 0, 30, -8, 0], E: { roar: 0.2 }, look: 'crowd' }],
      [0.10, { P: [0, -0.12, 0, 12, 0, 0], RL: LEG.load, LL: LEG.load }],
      [0.15, { P: [0, -0.02, 0, 2, 0, 0], RL: LEG.takeoff, LL: LEG.takeoff, RF: 'fist', E: { roar: 0.8 }, ev: 'takeoff' }],
      // right-fist uppercuts at 0.25, 0.45, 0.65
      [0.20, { RA: [60, 20, 0, 110, 0, 0, 0], RL: [40, 8, 0, 70, 30, 0], LL: [30, 8, 0, 60, 30, 0] }],
      [0.25, { RA: [150, 20, 0, 40, 0, 0, 0] }],
      [0.35, { RA: [60, 20, 0, 110, 0, 0, 0] }],
      [0.45, { RA: [150, 20, 0, 40, 0, 0, 0] }],
      [0.15 + LS, { ev: 'apex' }],
      [0.55, { RA: [60, 20, 0, 110, 0, 0, 0] }],
      [0.15 + 2 * LS, { P: [0, -0.12, 0, 10, 0, 0], RL: LEG.land, LL: LEG.land, ev: 'land' }],
      [0.65, { RA: [150, 20, 0, 40, 0, 0, 0] }],
      [0.90, { RA: [70, 20, 0, 100, 0, 0, 0], P: [0, -0.06, 0, 6, 0, 0], RL: [20, 6, 0, 30, -8, 0], LL: [20, 6, 0, 30, -8, 0], E: { roar: 0.6 } }],
      [1.40, { RA: [15, 15, 0, 40, 20, 0, 0], RF: 'relax', P: [0, -0.03, 0, 4, 0, 0], E: { roar: 0.1 } }],
    ],
  }),
  defineClip({
    id: 'cel.jordan.fistJog', dur: 1.00, mask: 'upper', layer: 'upper', root: 'none', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.30,
    params: { cat: 'cel' },
    keys: [
      [0.00, { RA: [40, 20, 0, 80, 0, 0, 0], E: { smirk: 0.2 } }],
      [0.20, { RA: [70, 20, 0, 120, 0, 0, 0], RF: 'fist', E: { smirk: 0.6 } }],
      [0.40, { RA: [30, 20, 0, 120, 0, 0, 0] }],
      [0.60, { RA: [60, 20, 0, 115, 0, 0, 0] }],
      [1.00, { RA: [20, 15, 0, 60, 20, 0, 0], RF: 'relax', E: { smirk: 0.5 } }],
    ],
  }),
  defineClip({
    id: 'cel.jordan.pointSmirk', dur: 1.20, mask: 'upper', layer: 'upper', root: 'none', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.30,
    params: { cat: 'cel' },
    keys: [
      [0.00, { RA: [40, 20, 0, 60, 30, 0, 0], E: { smirk: 0 }, look: 'crowd' }],
      [0.20, { RA: [90, 30, 0, 10, 60, 0, 0], RF: 'point', S: [0, 15, 0] }],
      [0.40, { E: { smirk: 0.8 } }],
      [0.90, { RA: [88, 30, 0, 12, 60, 0, 0] }],
      [1.20, { RA: [15, 15, 0, 40, 20, 0, 0], RF: 'relax', S: [0, 0, 0], E: { smirk: 0.6 } }],
    ],
  }),
  // the game-winning hold: follow-through kept ≈ 1 s after landing, feet together, lean back 5°, then a fist
  defineClip({
    id: 'cel.jordan.lastShot', dur: 1.40, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.30,
    params: { cat: 'cel' },
    keys: [
      [0.00, { RA: [155, 4, 15, 0, 95, 85, 0], LA: [90, 20, 0, 20, 0, 0, 0], RF: 'snap', P: [0, -0.04, 0, -5, 0, 0], S: [-4, 0, 0], N: [-6, 0, 0], RL: [5, 2, 0, 10, 0, 0], LL: [5, 2, 0, 10, 0, 0],
        Rft: [-0.09, 0, 0, 'f'], Lft: [0.09, 0, 0, 'f'], look: 'rim', E: { tongueOut: 0 } }],
      [1.00, { RA: [153, 4, 15, 0, 95, 85, 0], P: [0, -0.04, 0, -5, 0, 0] }],
      [1.15, { RA: [90, 20, 0, 110, 0, 0, 0], RF: 'fist', P: [0, -0.06, 0, 6, 0, 0], S: [8, 0, 0], E: { roar: 0.7 } }],
      [1.40, { RA: [50, 20, 0, 110, 0, 0, 0], LA: [20, 15, 0, 30, 20, 0, 0], E: { roar: 0.5 } }],
    ],
  }),
];

// ---------------------------------------------------------------------------------------------------------------
// Idle habits ([ANIM §8.3])
// ---------------------------------------------------------------------------------------------------------------
const STAND = STANCE.stand;
const standKey = { P: STAND.P, S: STAND.S, N: STAND.N, RA: STAND.RA, LA: STAND.LA, RL: STAND.RL, LL: STAND.LL, Rft: STAND.Rft, Lft: STAND.Lft };
const BENT = { P: [0, -0.08, -0.05, 18, 0, 0], S: [45, 0, 0], N: [-10, 0, 0], RA: [30, 10, 20, 25, 30, 0, 0], LA: [30, 10, 20, 25, 30, 0, 0], RF: 'grip', LF: 'grip',
  RL: [25, 4, 0, 30, -8, 0], LL: [25, 4, 0, 30, -8, 0] };
const idles = [
  defineClip({
    id: 'idle.jordan.shortsGrip', dur: 2.4, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.30, blendOut: 0.30,
    params: { cat: 'idle', breathing: 2.5 },
    keys: [
      [0.00, { ...standKey }],
      [0.45, { ...BENT, N: [15, 0, 0] }],
      [1.20, { S: [47, 0, 0], N: [18, 0, 0] }],
      [2.00, { ...BENT, N: [15, 0, 0] }],
      [2.40, { ...standKey, RF: 'relax', LF: 'relax' }],
    ],
  }),
  defineClip({
    id: 'idle.jordan.soleWipe', dur: 2.4, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.25, blendOut: 0.30, params: { cat: 'idle' },
    keys: [
      [0.00, { ...standKey }],
      // right foot lifted behind, right palm swipes the sole; then the left
      [0.25, { Rft: null, RL: [-20, 5, 0, 100, 20, 0], S: [15, -10, 0], RA: [-30, 20, 30, 40, 60, 0, 0], RF: 'flat', N: [10, -20, 0] }],
      [0.60, { RA: [-35, 20, 30, 30, 60, 10, 0] }],
      [0.95, { Rft: STAND.Rft, RL: STAND.RL, S: STAND.S, RA: STAND.RA, RF: 'relax', N: [0, 0, 0] }],
      [1.20, { Lft: null, LL: [-20, 5, 0, 100, 20, 0], S: [15, 10, 0], LA: [-30, 20, 30, 40, 60, 0, 0], LF: 'flat', N: [10, 20, 0] }],
      [1.55, { LA: [-35, 20, 30, 30, 60, 10, 0] }],
      [1.95, { Lft: STAND.Lft, LL: STAND.LL, S: STAND.S, LA: STAND.LA, LF: 'relax', N: [0, 0, 0] }],
      [2.40, { ...standKey }],
    ],
  }),
  defineClip({
    id: 'idle.jordan.clap', dur: 0.6, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.20, params: { cat: 'idle' },
    keys: [
      [0.00, { RA: [20, 15, 0, 40, 20, 0, 0], LA: [20, 15, 0, 40, 20, 0, 0], look: 'man' }],
      [0.20, { RA: [55, 35, 20, 80, -20, 0, 0], LA: [55, 35, 20, 80, -20, 0, 0], RF: 'flat', LF: 'flat' }],
      [0.30, { RA: [55, 12, 40, 70, -10, 0, 0], LA: [55, 12, 40, 70, -10, 0, 0] }],
      [0.60, { RA: [25, 15, 0, 40, 20, 0, 0], LA: [25, 15, 0, 40, 20, 0, 0], RF: 'relax', LF: 'relax' }],
    ],
  }),
  defineClip({
    id: 'idle.jordan.palmsFloor', dur: 0.9, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.15, blendOut: 0.25, params: { cat: 'idle' },
    keys: [
      [0.00, { P: STANCE.def.jordan.P, S: STANCE.def.jordan.S, N: STANCE.def.jordan.N, RA: STANCE.def.jordan.RA, LA: STANCE.def.jordan.LA, RL: LEG.def, LL: LEG.def,
        Rft: [-0.40, 0.03, -10, 't'], Lft: [0.40, -0.03, 10, 't'], look: 'man' }],
      // both palms slap the floor
      [0.30, { P: [0, -0.36, 0, 25, 0, 0], S: [35, 0, 0], N: [-45, 0, 0], RA: [55, 25, 0, 5, 60, -60, 0], LA: [55, 25, 0, 5, 60, -60, 0], RF: 'flat', LF: 'flat',
        RL: [60, 14, 0, 85, -25, 0], LL: [60, 14, 0, 85, -25, 0] }],
      [0.40, { RA: [57, 25, 0, 5, 60, -70, 0], LA: [57, 25, 0, 5, 60, -70, 0] }],
      [0.90, { P: STANCE.def.jordan.P, S: STANCE.def.jordan.S, N: STANCE.def.jordan.N, RA: STANCE.def.jordan.RA, LA: STANCE.def.jordan.LA, RF: 'relax', LF: 'relax', RL: LEG.def, LL: LEG.def }],
    ],
  }),
];

/** Jordan's clips (shared registrations). */
export const JORDAN_CLIPS = Object.freeze([
  turnFade, ftDunk, theMove, cradle, jab, jabShot, ripDrive, pullup, steal, ...cels, ...idles,
]);
