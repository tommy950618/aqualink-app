/**
 * clips/kobe.js — Kobe Bryant's signature clips, celebrations and idle habits (spec §4.11, §4.12,
 * [ANIM §9.1 K1–K6, §8.2, §8.3]).
 *
 * Exports
 *   KOBE_CLIPS  normalised ClipDefs (shared registrations; times final, tempo false):
 *     sig.kobe.turnFade, sig.kobe.jabSeries, sig.kobe.ripPullup, sig.kobe.jabGo, sig.kobe.pump,
 *     sig.kobe.sideStepPullup, sig.kobe.baselineSpinLay, sig.kobe.baselineSpinFade, sig.kobe.tomahawk,
 *     sig.kobe.reverse2, sig.kobe.hesiCrossStepback, sig.kobe.hesiCrossStepbackShot,
 *     cel.kobe.jawJut, cel.kobe.fingerUp, cel.kobe.fistClench, cel.kobe.shrug,
 *     idle.kobe.neckRoll, idle.kobe.fingerFlex, idle.kobe.handsKnees, idle.kobe.collarBite, idle.kobe.floorSlap
 *
 * Event times reproduce select.js (spec §4.12 table): e.g. turnFade takeoff 0.70 / set 0.83 / release 1.009 /
 * land 1.34; tomahawk slam 0.716, rim 0.746–0.846, land 1.218. Corrections to the profile-derived tables (all keep the
 * binding times): plant positions of approach clips follow the root curve (a foot lands just ahead of the hips),
 * the side-step pull-up's `P[-0.65, …, 0.45]` entries are root positions (R), not pelvis offsets, and a hip flexion
 * above 95° is keyed just after the takeoff (cloth guard).
 */
import { defineClip } from '../clip.js';
import { SET, REL, FOLLOW, SHORT, LEG, ARM, FORMS, STANCE } from '../presets.js';
import { th, jumpTail, relBall, rootAt, G, guideSet, SLAM1, GRIP2, HAMMER1, HAMMER2, JAB_HOLD, JAB_SWAY, RIP_LOW, RIP_HIP_L, defineJump } from './shots.js';

const F = FORMS.kobe;
const SCOWL = { scowl: 0.4 };

// ---------------------------------------------------------------------------------------------------------------
// K1 turnaround fadeaway (right block, left-foot pivot over the left shoulder toward the baseline)
// ---------------------------------------------------------------------------------------------------------------
const turnFade = defineClip({
  id: 'sig.kobe.turnFade', dur: 1.60, mask: 'full', root: 'motion', entry: 'stop', entryDecel: 20, tempo: false, jump: { h: 0.50 },
  hand: 'R', cancel: 1.44, blendIn: 0.06, blendOut: 0.20, target: 'takeoff',
  params: { cat: 'jumper', meterFrom: 0.50, tIdeal: 0.959, METER_T: 0.574, baseSide: 'R' },
  keys: [
    [0.00, { P: [0, -0.10, 0, 12, 0, 0], S: [20, 0, 0], N: [-22, 35, 0], ...SHORT.HIP_R, RL: [35, 8, 0, 45, -10, 0], LL: [35, 8, 0, 45, -10, 0],
      Rft: [-0.38, 0, 0, 'f'], Lft: [0.37, 0, 0, 't'], RF: 'grip', LF: 'grip', B: 'both', look: 'none', R: [0, 0, 0], E: SCOWL }],
    // shoulder fake: ball to the left hip, 70 % weight right (the defender bites)
    [0.20, { P: [-0.08, -0.11, 0, 12, -10, 0], S: [20, -20, -12], N: [-20, 15, 0], RA: [30, 0, 40, 95, 20, -15, 0], LA: [15, 20, 10, 75, 40, -20, 0] }],
    [0.30, { P: [-0.08, -0.11, 0, 12, -10, 0], S: [20, -20, -12], ev: 'fake' }],
    [0.32, { Rft: null, RL: [30, 25, 0, 60, 10, 0], R: [0, 0, 0] }],
    // spin over the left shoulder: pelvis leads 15°, spine lags 20°
    [0.40, { R: [0.30, 0.03, 80], P: [0, -0.12, 0, 8, 15, 0], S: [15, -20, 0], N: [-10, 10, 0] }],
    [0.50, { R: [0.63, 0.10, 160], P: [0, -0.13, 0, 8, 0, 0], S: [12, 0, 0], N: [-10, 0, 0], Lft: [0.37, 0, 160, 't'], Rft: [0.89, 0.19, 160, 'f'],
      ...SHORT.CHEST, look: 'rim', ev: ['plantR', 'gather'] }],
    // load, knees 65
    [0.63, { P: [0, -0.16, 0, 10, 0, 0], S: [5, 0, 0], N: [-8, 0, 0], ...SHORT.CHIN, RL: [45, 6, 0, 65, -20, 0], LL: [45, 6, 0, 65, -20, 0], Lft: [0.37, 0, 165, 'f'] }],
    [0.70, { P: [0, -0.04, 0, 0, 0, 0], S: [0, 0, 0], RA: [100, 8, 20, 110, 80, -55, 0], RL: LEG.takeoff, LL: LEG.takeoff, Rft: null, Lft: null, R: [0.63, 0.10, 165], ev: 'takeoff' }],
    [0.83, { P: [0, 0, 0, -9, 0, 0], S: [-9, 0, 0], N: [-8, 0, 0], RA: SET('kobe'), LA: guideSet('kobe'), RF: 'shoot', RL: [25, 5, 0, 40, 30, 0], LL: [10, 5, 0, 25, 30, 0], E: SCOWL, ev: 'set' }],
    [0.70 + th(0.50), { ev: 'apex' }],
    [1.009, { RA: REL('kobe'), LA: [105, 27, 30, 80, -5, 0, 0], B: 'free', P: [null, null, null, -9, 0, 0], S: [-9, 0, 0], ev: 'release' }],
    [1.11, { RA: FOLLOW('kobe'), RF: 'snap', LA: [100, 32, 25, 70, -15, 0, 0] }],
    [1.34, { P: [0, -0.10, 0, 8, 0, 0], S: [4, 0, 0], RL: LEG.land, LL: LEG.land, Rft: [0.61, 0.56, 165, 'f'], Lft: [0.23, 0.46, 165, 'f'], R: [0.42, 0.51, 165], ev: 'land' }],
    [1.44, { Rft: null, RL: [30, 6, 0, 45, 10, 0] }],
    [1.46, { RA: [157, 4, 15, 0, 95, 70, 0] }],
    [1.50, { Rft: [0.63, 0.66, 165, 'f'], RL: LEG.land }],
    [1.60, { P: [0, -0.03, 0, 4, 0, 0], S: [4, 0, 0], N: [0, 0, 0], ...SHORT.DOWN, RF: 'relax', LF: 'relax' }],
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// K2 jab series (move) + rip pull-up (shot) + jab-go (drive), left-foot pivot from the triple threat
// ---------------------------------------------------------------------------------------------------------------
const JAB0 = { P: [0, -0.11, 0, 12, 0, 0], S: [25, 0, 0], N: [-25, 0, 0], ...JAB_HOLD };
const jabSeries = defineClip({
  id: 'sig.kobe.jabSeries', dur: 0.53, mask: 'full', root: 'none', tempo: false, hand: 'R', cancel: 0.47, blendIn: 0.06, blendOut: 0.12,
  params: { cat: 'move', branch: [0.17, 0.47] },
  keys: [
    [0.00, { ...JAB0, RL: STANCE.tripleThreat.RL, LL: STANCE.tripleThreat.LL, Rft: [-0.30, 0.05, 8, 'f'], Lft: [0.30, -0.05, 8, 't'], B: 'both', RF: 'grip', LF: 'grip', look: 'man', E: SCOWL }],
    [0.05, { Rft: null, RL: [35, 6, 0, 55, 10, 0], P: [-0.03, -0.13, 0.02, 14, 0, 0] }],
    // jab 1: 0.35 m at the defender
    [0.12, { Rft: [-0.30, 0.40, 8, 't'], RL: [30, 6, 0, 35, 5, 0], P: [-0.06, -0.15, 0.05, 15, 0, 0], S: [35, 0, 0], ev: ['plantR', 'fake'] }],
    [0.17, { ...JAB_SWAY, P: [-0.06, -0.16, 0.05, 15, 0, 0] }],
    [0.22, { Rft: null, RL: [35, 6, 0, 50, 10, 0] }],
    [0.30, { Rft: [-0.30, 0.05, 8, 'f'], RL: STANCE.tripleThreat.RL, ...JAB0 }],
    [0.35, { Rft: null, RL: [30, 6, 0, 45, 10, 0] }],
    // jab 2: 0.20 m + head fake up, shoulders +3 cm
    [0.40, { Rft: [-0.30, 0.25, 8, 't'], RL: [30, 6, 0, 40, 0, 0], N: [-35, 0, 0], RC: [8, 0], LC: [8, 0], P: [0, -0.08, 0.03, 10, 0, 0], ev: 'fake' }],
    [0.43, { Rft: null }],
    [0.47, { Rft: [-0.30, 0.05, 8, 'f'], RL: STANCE.tripleThreat.RL, N: [-25, 0, 0], RC: [0, 0], LC: [0, 0], P: [0, -0.10, 0, 12, 0, 0] }],
    [0.53, { P: [0, -0.11, 0, 12, 0, 0], S: [25, 0, 0] }],
  ],
});

/** Rip pull-up: ball low across the knees, to the left hip, up through the chest; straight-up jumper h 0.55. */
const ripT = { TO: 0.19, apex: 0.19 + th(0.55), tSet: 0.385, tRel: 0.515, tLand: 0.86, tEnd: 1.05 };
const ripPullup = defineClip({
  id: 'sig.kobe.ripPullup', dur: 1.05, mask: 'full', root: 'motion', entry: 'stop', entryDecel: 18, tempo: false, jump: { h: 0.55 },
  hand: 'R', cancel: 0.96, blendIn: 0.06, blendOut: 0.20,
  params: { cat: 'jumper', meterFrom: 0, tIdeal: 0.465, METER_T: 0.58 },
  keys: [
    [0.00, { ...JAB0, RL: STANCE.tripleThreat.RL, LL: STANCE.tripleThreat.LL, Rft: [-0.30, 0.05, 8, 'f'], Lft: [0.30, -0.05, 8, 'f'], B: 'both', RF: 'grip', LF: 'grip', look: 'rim', R: [0, 0, 0], E: SCOWL }],
    [0.06, { ...RIP_LOW, S: [35, -15, 0], P: [0, -0.13, 0, 13, 0, 0] }],
    [0.10, { ...RIP_HIP_L, S: [30, 10, 0] }],
    [0.14, { RA: [60, 15, 30, 120, 40, -40, 0], LA: [60, 20, 35, 115, -5, -20, 0], P: [0, -0.15, 0, 10, 0, 0], S: [12, 0, 0], N: [-12, 0, 0], RL: [45, 6, 0, 62, -18, 0], LL: [45, 6, 0, 62, -18, 0] }],
    ...jumpTail('kobe', ripT, { R: [0, 0, 0], face: SCOWL, armsTO: false }),
  ],
});

/** Jab-go: from the jab-2 pose, crossover step past the defender's hip with a push-out dribble before the pivot lifts. */
const jabGo = defineClip({
  id: 'sig.kobe.jabGo', dur: 0.40, mask: 'full', root: 'motion', entry: 'replace', tempo: false, hand: 'R', blendIn: 0.06, blendOut: 0.12,
  params: { cat: 'move', exitV: [0, 4.5] },
  keys: [
    [0.00, { P: [0, -0.08, 0.03, 10, 0, 0], S: [28, 0, 0], N: [-30, 0, 0], ...JAB_HOLD, RL: [30, 6, 0, 40, 0, 0],
      LL: STANCE.tripleThreat.LL, Rft: [-0.30, 0.25, 8, 't'], Lft: [0.30, -0.05, 8, 't'], B: 'both', RF: 'grip', LF: 'grip', R: [0, 0, 0], look: 'man' }],
    [0.08, { Rft: null, RL: [45, -5, 10, 70, 10, 0], P: [0, -0.14, 0.05, 18, 0, 0], S: [30, 0, 0], ...JAB_HOLD }],
    [0.12, { B: 'R' }],                                                  // right hand pulls it out for the push dribble
    [0.18, { RA: [45, 10, 15, 45, 90, 20, 0], B: 'drib', LA: [30, 20, 0, 50, 10, 0, 0], LF: 'relax' }],
    [0.20, { Rft: [-0.10, 0.90, 0, 't'], RL: [40, 5, 0, 50, -10, 0], ev: 'plantR' }],
    [0.14, { Lft: null, LL: [-10, 5, 0, 40, 30, 0] }],
    [0.40, { P: [0, -0.12, 0, 16, 0, 0], S: [24, 0, 0], N: [-14, 0, 0], LL: [40, 5, 0, 70, 10, 0], R: [0.10, 1.30, 0] }],
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// K3 pump fake (move) + side-step pull-up (one hard dribble right, hop stop, jumper)
// ---------------------------------------------------------------------------------------------------------------
const pump = defineClip({
  id: 'sig.kobe.pump', dur: 0.30, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.06, blendOut: 0.12,
  params: { cat: 'move' },
  keys: [
    [0.00, { ...SHORT.CHEST, P: [0, -0.10, 0, 10, 0, 0], S: [12, 0, 0], N: [-10, 0, 0], RL: [25, 6, 0, 40, -10, 0], LL: [25, 6, 0, 40, -10, 0], B: 'both', RF: 'grip', LF: 'grip', look: 'rim', E: SCOWL }],
    [0.08, { RA: [90, 8, 20, 110, 70, -50, 0], LA: [80, 14, 40, 105, 10, -20, 0] }],
    [0.18, { RA: [140, 6, 18, 95, 85, -60, 0], LA: guideSet('kobe'), RF: 'shoot', RL: [10, 4, 0, 30, 8, 0], LL: [10, 4, 0, 30, 8, 0], P: [0, -0.06, 0, 6, 0, 0], RC: [8, 0], LC: [8, 0], N: [-15, 0, 0], ev: 'fake' }],
    [0.30, { ...SHORT.CHEST, RF: 'grip', P: [0, -0.10, 0, 10, 0, 0], RL: [25, 6, 0, 40, -10, 0], LL: [25, 6, 0, 40, -10, 0], RC: [0, 0], LC: [0, 0], N: [-10, 0, 0] }],
  ],
});

const ssT = { TO: 0.33, apex: 0.33 + th(0.50), tSet: 0.509, tRel: 0.639, tLand: 0.97, tEnd: 1.05 };
const sideStepPullup = defineClip({
  id: 'sig.kobe.sideStepPullup', dur: 1.05, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h: 0.50 }, hand: 'R',
  cancel: 1.05, blendIn: 0.06, blendOut: 0.20,
  params: { cat: 'jumper', meterFrom: 0.12, tIdeal: 0.589, METER_T: 0.586 },
  keys: relBall([
    [0.00, { B: 'path', RA: [45, 25, 15, 60, 90, 15, 0], LA: [30, 25, 0, 45, 10, 0, 0], Bp: [-0.35, 0.60, 0.30], P: [0, -0.20, 0, 20, -10, 0], S: [20, 0, 10],
      N: [-12, 0, 0], RL: [40, 10, 0, 60, -15, 0], LL: [40, 10, 0, 60, -15, 0], Rft: null, Lft: null, RF: 'grip', look: 'rim', R: [0, 0, 0], E: SCOWL }],
    // one hard dribble pushed 0.9 m right and forward
    [0.08, { Bp: [-0.75, 0.12, 0.40], RA: [35, 30, 15, 40, 90, 25, 0], RL: [35, 15, 0, 50, 10, 0], ev: 'bounce' }],
    [0.12, { Rft: [-0.85, 0.45, 0, 'f'], RL: [40, 10, 0, 55, -15, 0], B: 'both', Bp: [-0.10, 0.95, 0.30], ...SHORT.CHEST, LF: 'grip', R: [-0.55, 0.35, 0], ev: 'plantR' }],
    [0.17, { Lft: [-0.40, 0.55, 0, 'f'], LL: [40, 10, 0, 55, -15, 0], P: [0, -0.18, 0, 12, 0, 0], S: [8, 0, 0], R: [-0.63, 0.50, 0], ev: 'plantL' }],
    [0.25, { P: [0, -0.13, 0, 8, 0, 0], S: [4, 0, 0], ...SHORT.CHIN, RL: [35, 6, 0, 55, -18, 0], LL: [35, 6, 0, 55, -18, 0] }],
    ...jumpTail('kobe', ssT, {
      land: { R: [-0.83, 0.60], L: [-0.43, 0.57], yaw: 10 }, R: [-0.63, 0.60, 0], face: SCOWL,
    }),
    [0.33, { R: [-0.63, 0.50, 0] }],
  ]),
});

// ---------------------------------------------------------------------------------------------------------------
// K4 baseline spin → reverse layup / fadeaway (from the right baseline, right-hand dribble toward the baseline)
// ---------------------------------------------------------------------------------------------------------------
/** Spin part 0–0.47 shared by the two clips. */
function spinPart() {
  return [
    [0.00, { P: [0, -0.10, 0, 14, 0, 0], S: [25, 0, 0], N: [-12, 0, 0], B: 'drib', RA: ARM.dribRun, LA: [35, 20, 0, 40, 10, 0, 0], RF: 'grip',
      RL: [30, 6, 0, 45, 10, 0], LL: [-5, 4, 0, 25, 25, 0], Rft: null, Lft: null, R: [0, 0, 0], look: 'rim', E: SCOWL }],
    [0.13, { Lft: [0.20, 0.45, 45, 't'], LL: [40, 8, 0, 60, -15, 0], P: [0, -0.15, 0, 12, 0, 0], ev: 'plantL' }],
    [0.20, { B: 'both', ...SHORT.HIP_R, LF: 'grip', ev: 'gather' }],
    [0.27, { R: [0.10, 0.30, -30], RL: [30, 25, 0, 65, 10, 0], RA: GRIP2.chinOut, LA: GRIP2.chinOut }],
    [0.40, { R: [0.35, 0.42, -140], P: [null, null, null, null, -15, null] }],
    [0.47, { R: [0.45, 0.45, -180], Lft: [0.20, 0.45, -135, 't'], Rft: [0.70, 0.45, -180, 'f'], RL: [40, 8, 0, 55, -15, 0], P: [0, -0.15, 0, 10, 0, 0], ev: 'plantR' }],
  ];
}

const baselineSpinLay = defineJump({
  id: 'sig.kobe.baselineSpinLay', dur: 1.30, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h: 0.55 }, meter: 'key',
  hand: 'R', cancel: 1.30, blendIn: 0.08, blendOut: 0.20,
  params: { cat: 'layup', meterFrom: 0.47, tIdeal: 0.855, METER_T: 0.48, gatherWindow: [0, 4.5] },
  keys: [
    ...spinPart(),
    [0.55, { Lft: null, LL: [60, 5, 0, 90, 10, 0], P: [0, -0.10, 0, 6, 0, 0], RA: GRIP2.chinOut, LA: GRIP2.chinOut }],
    [0.60, { RL: [95, 5, 0, 100, 30, 0], Rft: null, LL: [-10, 3, 0, 10, 40, 0], P: [0, -0.03, 0, 2, 0, 0], RA: [120, 20, 15, 60, 30, -30, 0], B: 'R', LF: 'relax', ev: 'takeoff' }],
    [0.80, { RA: [170, 25, 0, 15, 30, -30, 0], N: [-30, 0, 0], S: [-8, 0, 0], LA: [60, 40, 20, 60, 0, 0, 0] }],
    [0.905, { RA: [175, 28, 0, 10, 30, 40, 0], B: 'free', LA: [60, 40, 20, 60, 0, 0, 0], E: { scowl: 0.4, jawOpen: 0.3 }, ev: 'release' }],
    [0.60 + th(0.55), { ev: 'apex' }],
    [1.00, { RF: 'snap', RA: [170, 25, 0, 10, 30, 50, 0] }],
    [1.27, { RL: LEG.layLand, LL: LEG.layLand, Rft: [0.27, 0.45, -180, 'f'], Lft: [0.63, 0.45, -180, 'f'], P: [0, -0.10, 0, 8, 0, 0], S: [6, 0, 0], N: [-5, 0, 0], ev: 'land' }],
    [1.30, { ...SHORT.DOWN, RF: 'relax', E: { scowl: 0.4, jawOpen: 0 } }],
  ],
});

/** Fade branch = sig.kobe.turnFade keys from its 0.63 key on, re-timed −0.08 (load 0.47–0.55, takeoff 0.62). */
const bsT = { TO: 0.62, apex: 0.62 + th(0.50), tSet: 0.80, tRel: 0.929, tLand: 1.26, tEnd: 1.52 };
const baselineSpinFade = defineClip({
  id: 'sig.kobe.baselineSpinFade', dur: 1.52, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h: 0.50 }, hand: 'R',
  cancel: 1.36, blendIn: 0.06, blendOut: 0.20,
  params: { cat: 'jumper', meterFrom: 0.40, tIdeal: 0.879, METER_T: 0.60 },
  keys: [
    ...spinPart(),
    [0.55, { P: [0, -0.16, 0, 10, 0, 0], S: [5, 0, 0], N: [-8, 0, 0], ...SHORT.CHIN, RL: [45, 6, 0, 65, -20, 0], LL: [45, 6, 0, 65, -20, 0], Lft: [0.20, 0.45, -175, 'f'] }],
    ...jumpTail('kobe', bsT, {
      lean: F.fadeLean, air: F.airFade, land: { R: [0.25, 0.0], L: [0.65, -0.03], yaw: -175 }, R: [0.45, 0, -180], face: SCOWL,
    }),
    [0.62, { R: [0.45, 0.45, -180] }],
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// K5 transition tomahawk (right hand) and two-hand reverse baseline dunk
// ---------------------------------------------------------------------------------------------------------------
const TOM = { TO: 0.36, h: 0.73, slam: 0.716, hang: 0.10 };
TOM.land = TOM.TO + (TOM.slam - TOM.TO) + 0.03 + TOM.hang + Math.sqrt(2 * (TOM.h - 0.05) / G);
const tomRk = [[0, { R: [0, 0, 0] }], [0.36, { R: [0, 1.30, 0] }], [0.716, { R: [0, 2.60, 0] }]];
const tomahawk = defineJump({
  id: 'sig.kobe.tomahawk', dur: 1.50, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h: 0.73, hang: 0.10 }, meter: false,
  hand: 'R', cancel: 1.32, blendIn: 0.10, blendOut: 0.25, target: 'takeoff',
  params: { cat: 'dunk', hands: 1, gatherWindow: [2.25, 3.65], dTO: 1.65, toDist: 1.30 },
  keys: [
    ...tomRk,
    [0.00, { B: 'R', RA: ARM.ballCupped, LA: [35, 20, 0, 40, 10, 0, 0], Rft: [-0.12, 0, 0, 'f'], Lft: null, P: [0, -0.08, 0, 10, 0, 0], S: [12, 0, 0], N: [-10, 0, 0],
      RL: [15, 5, 0, 25, -5, 0], LL: [40, 5, 0, 70, 10, 0], RF: 'grip', look: 'rim', E: { scowl: 0.4 }, ev: ['gather', 'plantR'] }],
    [0.12, { Rft: null, RL: [35, 5, 0, 60, 15, 0], LL: [20, 5, 0, 30, 0, 0] }],
    [0.28, { Lft: [0.10, rootAt(tomRk, 0.28)[1] + 0.25, 0, 'f'], P: [0, -0.14, 0, -6, 0, 0], S: [-6, 0, 0], LL: [30, 5, 0, 45, -15, 0], RL: [50, 5, 0, 90, 20, 0], ev: 'plantL' }],
    [0.36, { Lft: null, LL: [-10, 3, 0, 10, 40, 0], RL: [95, 5, 0, 100, 30, 0], LA: [120, 20, 20, 20, 0, 0, 0], P: [0, -0.03, 0, 0, 0, 0], ev: 'takeoff' }],
    [0.40, { RL: [100, 5, 0, 100, 30, 0] }],
    // ball behind the right ear (forearm rotated out 15°, not 40: at −40 the ball swings out beside the head)
    [0.56, { RA: [178, 25, -15, 110, 0, -40, 0], S: [-15, 0, 0], N: [-15, 0, 0], LL: [20, 5, 0, 40, 30, 0], E: { scowl: 0.2, jawJut: 0.6 } }],
    [0.67, { RA: [175, 12, 0, 20, 40, -45, 0], S: [-2, 0, -8] }],
    [0.716, { ...SLAM1, B: 'free', ev: 'slam' }],
    [0.776, { RA: HAMMER1, S: [18, 0, 0], RC: [0, 0] }],
    [0.36 + th(0.73), { ev: 'apex' }],
    [0.746, { RF: 'claw', LA: [60, 30, 0, 40, 0, 0, 0], RL: LEG.dunkHang, LL: LEG.dunkHang, ev: 'rimGrab' }],
    [0.846, { RA: [140, 12, 0, 30, 60, 0, 0], RF: 'relax', ev: 'rimRelease' }],
    [TOM.land, { RL: [45, 8, 0, 50, -15, 0], LL: [45, 8, 0, 50, -15, 0], Rft: [-0.25, 2.70, 0, 'f'], Lft: [0.25, 2.70, 0, 'f'], P: [0, -0.14, 0, 14, 0, 0], S: [10, 0, 0],
      RA: [60, 25, 0, 50, 30, 0, 0], LA: [50, 25, 0, 50, 30, 0, 0], ev: 'land' }],
    [1.50, { P: [0, -0.06, 0, 6, 0, 0], S: [6, 0, 0], N: [0, 0, 0], ...SHORT.DOWN, E: { scowl: 0.35, jawJut: 0.6 } }],
  ],
});

const REV = { TO: 0.28, h: 0.85, slam: 0.72, land: 1.32 };
const reverse2 = defineJump({
  id: 'sig.kobe.reverse2', dur: 1.60, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h: 0.85, hang: 0.15 }, meter: false,
  hand: 'R', cancel: 1.42, blendIn: 0.10, blendOut: 0.25,
  params: { cat: 'dunk', hands: 2, gatherWindow: [1.0, 2.6] },
  keys: [
    [0.00, { B: 'both', ...SHORT.CHEST, RF: 'grip', LF: 'grip', P: [0, -0.10, 0, 12, 0, 0], S: [14, 0, 0], N: [-12, 0, 0], RL: [30, 6, 0, 45, 10, 0], LL: [-5, 4, 0, 25, 25, 0],
      Rft: null, Lft: null, R: [0, 0, 0], look: 'rim', E: { scowl: 0.4 } }],
    // jump stop facing the baseline, both feet
    [0.14, { Rft: [-0.22, 0.70, 0, 'f'], Lft: [0.22, 0.70, 0, 'f'], P: [0, -0.18, 0, 15, 0, 0], S: [16, 0, 0], RL: LEG.dunkPlant, LL: LEG.dunkPlant, R: [0, 0.60, 0], ev: ['plantL', 'plantR'] }],
    [0.28, { Rft: null, Lft: null, RL: LEG.dunkTakeoff, LL: LEG.dunkTakeoff, P: [0, -0.02, 0, 0, 0, 0], S: [-4, 0, 0], RA: GRIP2.skip, LA: GRIP2.skip, R: [0, 0.75, 0], ev: 'takeoff' }],
    // spine extends back, head back to see the rim; the slam goes backwards over the head
    [0.55, { S: [-25, 0, 0], N: [-30, 0, 0], RA: GRIP2.cock, LA: GRIP2.cock, RL: [40, 10, 0, 70, 30, 0], LL: [40, 10, 0, 70, 30, 0], E: { scowl: 0.2, jawJut: 0.5 } }],
    [0.72, { RA: GRIP2.slam, LA: GRIP2.slam, RC: [10, 0], LC: [10, 0], S: [-12, 0, 0], B: 'free', ev: 'slam' }],
    [0.78, { RA: HAMMER2, LA: HAMMER2, RC: [0, 0], LC: [0, 0] }],
    [0.28 + th(0.85), { ev: 'apex' }],
    [0.75, { RF: 'claw', LF: 'claw', RL: LEG.dunkHang, LL: LEG.dunkHang, ev: 'rimGrab' }],
    [0.90, { RA: [140, 15, 0, 40, 60, 0, 0], LA: [140, 15, 0, 40, 60, 0, 0], RF: 'relax', LF: 'relax', S: [0, 0, 0], ev: 'rimRelease' }],
    [REV.land, { RL: LEG.dunkLand, LL: LEG.dunkLand, Rft: [-0.25, 1.55, 0, 'f'], Lft: [0.25, 1.55, 0, 'f'], P: [0, -0.15, 0, 14, 0, 0], S: [10, 0, 0], N: [-5, 0, 0],
      RA: [60, 25, 0, 50, 30, 0, 0], LA: [60, 25, 0, 50, 30, 0, 0], R: [0, 1.50, 0], ev: 'land' }],
    [1.60, { P: [0, -0.06, 0, 6, 0, 0], S: [6, 0, 0], N: [0, 0, 0], ...SHORT.DOWN, E: { scowl: 0.35, jawJut: 0.6 } }],
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// K6 hesitation – low crossover – step-back (move part; the shot branch is a separate clip from the press)
// ---------------------------------------------------------------------------------------------------------------
const hesiCrossStepback = defineClip({
  id: 'sig.kobe.hesiCrossStepback', dur: 0.40, mask: 'full', root: 'motion', entry: 'carry', tempo: false, hand: 'R', cancel: 0.27, blendIn: 0.06, blendOut: 0.12,
  params: { cat: 'move', imm: [0.05, 0.27], freeze: 1.0, branch: 0.27 },
  keys: relBall([
    [0.00, { P: [0, -0.06, 0, 10, 0, 0], S: [15, 0, 0], N: [-8, 0, 0], RA: ARM.dribJog, LA: [25, 20, 0, 40, 20, 0, 0], RL: [25, 6, 0, 40, -5, 0], LL: [10, 6, 0, 30, 10, 0],
      B: 'path', Bp: [-0.29, 0.93, 0.51], R: [0, 0, 0], RF: 'grip', look: 'man', E: SCOWL }],
    // torso rises 5 cm, slight lean back: sells a stop
    [0.07, { P: [0, -0.01, 0, 2, 0, 0], S: [5, 0, 0], N: [-10, 0, 0], RA: [7, 14, 15, 60, 90, 0, 0], look: 'rim', Bp: [-0.31, 0.96, 0.32] }],
    // pelvis drops 12 cm, low crossover bounce in front
    [0.13, { P: [0, -0.13, 0, 18, 0, 0], S: [22, 0, 0], RA: [20, 5, 35, 75, 95, 30, 0], Bp: [0.0, 0.12, 0.30], N: [-14, 0, 0], look: 'man', ev: 'bounce' }],
    [0.16, { Rft: null, RL: [20, 8, 0, 35, 30, 0] }],
    [0.20, { Bp: [0.29, 0.69, 0.29], B: 'drib', LA: [36, 8, 25, 33, 90, 10, 0], LF: 'grip', RA: [25, 15, 0, 40, 20, 0, 0], RF: 'relax', R: [0.15, 0.20, 0], ev: 'handOnL' }],
    [0.27, { Lft: [0.25, 0.55, 0, 'f'], LL: [35, 6, 0, 50, -12, 0], ev: 'plantL' }],
    [0.32, { Rft: null, RL: [35, 6, 0, 60, 15, 0] }],
    [0.40, { R: [0.30, 0.40, 0], P: [0, -0.10, 0, 14, 0, 0], S: [18, 0, 0], RL: [25, 6, 0, 40, -5, 0] }],
  ]),
});

/** Shot branch from a press at 0.27: step-back lands 0.13 (0.70 back), takeoff 0.20, jumper (h 0.50), drift 0.10 back. */
const hcsT = { TO: 0.20, apex: 0.20 + th(0.50), tSet: 0.379, tRel: 0.509, tLand: 0.20 + 2 * th(0.50) };
hcsT.tEnd = Math.max(hcsT.tLand + 0.25, hcsT.tRel + F.followHold + 0.15);
const hesiCrossStepbackShot = defineClip({
  id: 'sig.kobe.hesiCrossStepbackShot', dur: hcsT.tEnd, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h: 0.50 }, hand: 'R',
  cancel: hcsT.tLand + 0.10, blendIn: 0.04, blendOut: 0.20, chain: true,
  params: { cat: 'jumper', meterFrom: 0, tIdeal: 0.459, METER_T: 0.574 },
  keys: [
    [0.00, { P: [0, -0.10, 0, 14, 0, 0], S: [18, 0, 0], N: [-10, 0, 0], ...SHORT.HIP_R, B: 'both', RF: 'grip', LF: 'grip', Lft: [0.25, 0.0, 0, 'f'], Rft: null,
      LL: [35, 6, 0, 50, -12, 0], RL: [35, 6, 0, 60, 15, 0], R: [0, 0, 0], look: 'rim', E: SCOWL }],
    [0.03, { Lft: null, LL: [20, 6, 0, 40, 30, 0], P: [0, -0.04, 0, 6, 0, 0] }],
    [0.13, { Lft: [0.20, -0.70, 0, 'f'], Rft: [-0.20, -0.70, 0, 'f'], RL: [40, 6, 4, 55, -20, 0], LL: [40, 6, 4, 55, -20, 0], P: [0, -0.12, 0, 10, 0, 0], ...SHORT.CHEST, R: [0, -0.70, 0], ev: ['plantL', 'plantR'] }],
    [0.17, { P: [0, -F.dip, 0, 10, 0, 0], RA: [20, 12, 25, 95, 40, -25, 0], LA: [25, 15, 35, 100, 10, -15, 0], N: [-12, 0, 0] }],
    ...jumpTail('kobe', hcsT, { lean: 4, drift: 0.80, land: { R: [-0.20, -0.80], L: [0.20, -0.83], yaw: 10 }, R: [0, -0.80, 0], face: SCOWL }),
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// Celebrations ([ANIM §8.2])
// ---------------------------------------------------------------------------------------------------------------
const cels = [
  defineClip({
    id: 'cel.kobe.jawJut', dur: 1.50, mask: 'upper', layer: 'upper', root: 'none', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.30,
    params: { cat: 'cel' },
    keys: [
      [0.00, { N: [-2, 0, 0], E: { jawJut: 0, scowl: 0.35 }, look: 'crowd' }],
      [0.15, { E: { jawJut: 1 } }],
      [0.20, { N: [-10, 0, 0] }],
      [0.60, { N: [-10, 0, 0] }], [0.70, { N: [12, 0, 0] }], [0.80, { N: [-10, 0, 0] }],
      [1.00, { N: [-10, 0, 0] }], [1.10, { N: [12, 0, 0] }], [1.20, { N: [-10, 0, 0], E: { jawJut: 1 } }],
      [1.50, { N: [-4, 0, 0], E: { jawJut: 0, scowl: 0.35 } }],
    ],
  }),
  defineClip({
    id: 'cel.kobe.fingerUp', dur: 1.40, mask: 'upper', layer: 'upper', root: 'none', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.30,
    params: { cat: 'cel' },
    keys: [
      [0.00, { RA: [40, 20, 0, 60, 0, 0, 0], E: { scowl: 0.4 }, look: 'none' }],
      [0.15, { RA: [150, 10, 0, 20, -30, 0, 0], RF: 'point', E: { scowl: 0.5 } }],
      [1.20, { RA: [148, 10, 0, 22, -30, 0, 0] }],
      [1.40, { RA: [40, 15, 0, 40, 20, 0, 0], RF: 'relax', E: { scowl: 0.4 } }],
    ],
  }),
  defineClip({
    id: 'cel.kobe.fistClench', dur: 1.00, mask: 'upper', layer: 'upper', root: 'none', tempo: false, hand: 'R', blendIn: 0.08, blendOut: 0.30,
    params: { cat: 'cel' },
    keys: [
      [0.00, { RA: [40, 20, 0, 60, 0, 0, 0], E: { roar: 0 } }],
      [0.15, { RA: [90, 20, 0, 100, 0, 0, 0], RF: 'fist', E: { roar: 0.6 }, S: [-4, 0, 0] }],
      [0.40, { RA: [20, 20, 0, 110, 0, 0, 0], S: [8, 0, 0], N: [-8, 0, 0] }],
      [0.75, { RA: [25, 20, 0, 105, 0, 0, 0], E: { roar: 0.5 } }],
      [1.00, { RA: [15, 15, 0, 40, 20, 0, 0], RF: 'relax', S: [4, 0, 0], E: { roar: 0 } }],
    ],
  }),
  defineClip({
    id: 'cel.kobe.shrug', dur: 1.00, mask: 'upper', layer: 'upper', root: 'none', tempo: false, hand: 'R', blendIn: 0.08, blendOut: 0.30,
    params: { cat: 'cel' }, noRhythm: true,
    keys: [
      [0.00, { RC: [0, 0], LC: [0, 0], RA: [15, 15, 0, 30, 20, 0, 0], LA: [15, 15, 0, 30, 20, 0, 0], N: [0, 0, 0], E: { scowl: 0.35 } }],
      [0.30, { RC: [15, 0], LC: [15, 0], RA: [20, 30, -20, 70, -60, -10, 0], LA: [20, 30, -20, 70, -60, -10, 0], RF: 'palmUp', LF: 'palmUp' }],
      // dismissive head shake at 3 Hz
      [0.40, { N: [0, 12, 0] }], [0.567, { N: [0, -12, 0] }], [0.733, { N: [0, 12, 0] }], [0.90, { N: [0, 0, 0] }],
      [1.00, { RC: [0, 0], LC: [0, 0], RA: [10, 12, 5, 25, 30, 0, 0], LA: [10, 12, 5, 25, 30, 0, 0], RF: 'relax', LF: 'relax' }],
    ],
  }),
];

// ---------------------------------------------------------------------------------------------------------------
// Idle habits ([ANIM §8.3])
// ---------------------------------------------------------------------------------------------------------------
const STAND = STANCE.stand;
const standKey = { P: STAND.P, S: STAND.S, N: STAND.N, RA: STAND.RA, LA: STAND.LA, RL: STAND.RL, LL: STAND.LL, Rft: STAND.Rft, Lft: STAND.Lft };
const idles = [
  defineClip({
    id: 'idle.kobe.neckRoll', dur: 2.0, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.25, blendOut: 0.30, params: { cat: 'idle' },
    keys: [
      [0.00, { ...standKey, E: { scowl: 0.35 } }],
      // head circles: roll ±15, yaw ±20; shoulders roll
      [0.40, { N: [10, 20, 15], RC: [6, 5], LC: [0, -5] }],
      [0.80, { N: [-15, 0, 0], RC: [0, 0], LC: [6, 5] }],
      [1.20, { N: [10, -20, -15], RC: [-3, -5], LC: [0, 0] }],
      [1.60, { N: [15, 0, 0], RC: [0, 0], LC: [0, 0] }],
      [2.00, { N: [0, 0, 0] }],
    ],
  }),
  defineClip({
    id: 'idle.kobe.fingerFlex', dur: 1.6, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.25, blendOut: 0.30, params: { cat: 'idle' },
    keys: [
      [0.00, { ...standKey, RA: [30, 15, 30, 95, 40, 0, 0], RF: 'relax', look: 'none', E: { scowl: 0.35 } }],
      [0.20, { RF: 'curlTape', N: [10, 0, 0] }],
      [1.40, { RF: 'curlTape' }],
      [1.60, { RA: STAND.RA, RF: 'relax', N: [0, 0, 0] }],
    ],
  }),
  defineClip({
    id: 'idle.kobe.handsKnees', dur: 2.4, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.30, blendOut: 0.30, params: { cat: 'idle' },
    keys: [
      [0.00, { ...standKey }],
      // bent 40°, hands tugging the shorts hem at the knees, head up watching
      [0.40, { P: [0, -0.08, -0.04, 15, 0, 0], S: [40, 0, 0], N: [-45, 0, 0], RA: [30, 10, 15, 30, 30, 0, 0], LA: [30, 10, 15, 30, 30, 0, 0], RF: 'grip', LF: 'grip',
        RL: [25, 4, 0, 30, -8, 0], LL: [25, 4, 0, 30, -8, 0] }],
      [1.20, { RA: [32, 10, 15, 34, 30, 0, 0], LA: [32, 10, 15, 34, 30, 0, 0] }],
      [2.00, { P: [0, -0.08, -0.04, 15, 0, 0], S: [40, 0, 0] }],
      [2.40, { ...standKey, RF: 'relax', LF: 'relax' }],
    ],
  }),
  defineClip({
    id: 'idle.kobe.collarBite', dur: 2.0, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.25, blendOut: 0.30, params: { cat: 'idle' },
    keys: [
      [0.00, { ...standKey }],
      [0.40, { RA: [60, 10, 40, 140, -40, 20, 0], RF: 'grip', N: [15, 0, 0] }],
      [1.50, { RA: [60, 10, 40, 140, -40, 22, 0], N: [15, 0, 0] }],
      [2.00, { RA: STAND.RA, RF: 'relax', N: [0, 0, 0] }],
    ],
  }),
  defineClip({
    id: 'idle.kobe.floorSlap', dur: 0.9, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.15, blendOut: 0.25, params: { cat: 'idle' },
    keys: [
      [0.00, { P: [0, -0.20, 0, 16, 0, 0], S: [15, 0, 0], N: [-28, 0, 0], RA: [70, 75, 0, 25, -30, 0, 0], LA: [70, 75, 0, 25, -30, 0, 0], RL: LEG.def, LL: LEG.def,
        Rft: [-0.425, 0.03, -10, 't'], Lft: [0.425, -0.03, 10, 't'], look: 'man', E: { scowl: 0.5 } }],
      // deep crouch, right palm slaps the floor once
      [0.30, { P: [0, -0.34, 0, 25, 0, 0], S: [35, 0, 0], N: [-45, 0, 0], RA: [60, 20, 0, 5, 60, -60, 0], RF: 'flat', RL: [60, 14, 0, 85, -25, 0], LL: [60, 14, 0, 85, -25, 0] }],
      [0.40, { RA: [62, 20, 0, 5, 60, -70, 0] }],
      [0.90, { P: [0, -0.24, 0, 18, 0, 0], S: [14, 0, 0], N: [-28, 0, 0], RA: [70, 75, 0, 25, -30, 0, 0], RF: 'relax', RL: LEG.def, LL: LEG.def }],
    ],
  }),
];

/** Kobe's clips (shared registrations). */
export const KOBE_CLIPS = Object.freeze([
  turnFade, jabSeries, ripPullup, jabGo, pump, sideStepPullup, baselineSpinLay, baselineSpinFade, tomahawk, reverse2,
  hesiCrossStepback, hesiCrossStepbackShot, ...cels, ...idles,
]);
