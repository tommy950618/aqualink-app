/**
 * clips/kyrie.js — Kyrie Irving's signature clips, celebrations and idle habits (spec §4.8, §4.11, §4.12,
 * [ANIM §9.6 Ky1–Ky6, §8.2, §8.3]).
 *
 * Exports
 *   KYRIE_CLIPS  normalised ClipDefs (shared registrations; times final, tempo false):
 *     sig.kyrie.hesiCross, sig.kyrie.doubleBtlStepback, sig.kyrie.doubleBtlStepbackShot, sig.kyrie.spinFinish,
 *     sig.kyrie.reverseLay, sig.kyrie.floater, sig.kyrie.scoop, sig.kyrie.btbPullup,
 *     cel.kyrie.holdFollow, cel.kyrie.skyPoint, cel.kyrie.shh, cel.kyrie.walkAway, cel.kyrie.bow,
 *     idle.kyrie.ballWrap, idle.kyrie.fingerSpin, idle.kyrie.handsHips, idle.kyrie.bounceWalk, idle.kyrie.chestTap,
 *     idle.kyrie.mouthguard
 *
 * No screaming, no three-finger gesture: his reactions are the held follow-through, a smirk, a skyward finger, a
 * chest tap, the "shh" and the walk-away. Times reproduce select.js: hesitation-crossover 0.67 s; double
 * between-the-legs 0.53 s + the shot branch from a press at 0.57 (takeoff 0.26, release 0.52, land 0.79); spin finish
 * takeoff 0.53 / release 0.82 / land 1.17; reverse layup takeoff 0.37 / release 0.675 / land 1.04; floater 0.17 / 0.40
 * / 0.74; behind-the-back pull-up takeoff 0.45 / set 0.606 / release 0.726 / land 1.02.
 */
import { defineClip } from '../clip.js';
import { GUIDE, SHORT, LEG, ARM, FORMS, STANCE } from '../presets.js';
import { th, jumpTail, relBall, tplFloater, tplReverseLay } from './shots.js';

const F = FORMS.kyrie;

// ---------------------------------------------------------------------------------------------------------------
// Ky1 hesitation crossover R → L (20 frames): rise as if to shoot, drop, low hard cross, explode left (ankle-eligible)
// ---------------------------------------------------------------------------------------------------------------
const hesiCross = defineClip({
  id: 'sig.kyrie.hesiCross', dur: 0.67, mask: 'full', root: 'motion', entry: 'carry', tempo: false, hand: 'R', blendIn: 0.06, blendOut: 0.12,
  params: { cat: 'move', imm: [0.05, 0.40], exitV: [2.0, 5.0], carryScale: [[0, 0.17, 0.40]], freeze: 1.2, ankle: true },
  keys: relBall([
    [0.00, { P: [0, -0.07, 0, 8, 0, 0], S: [15, 0, 0], N: [-10, 0, 0], RA: [25, 20, 15, 70, 90, 10, 0], LA: [25, 20, 0, 40, 20, 0, 0], RL: [25, 6, 0, 40, -5, 0], LL: [10, 6, 0, 30, 10, 0],
      B: 'path', Bp: [-0.32, 0.55, 0.25], RF: 'grip', R: [0, 0, 0], look: 'man' }],
    // right foot plants slightly ahead; pelvis RISES 6 cm; soft high dribble; left arm floats out; eyes up as if to shoot
    [0.10, { Rft: [-0.18, 0.35, 0, 'f'], RL: [20, 6, 0, 25, -8, 0], P: [0, -0.01, 0, 2, 0, 0], S: [5, 0, 0], N: [-15, 0, 0], LA: [20, 30, 0, 30, 0, 0, 0], Bp: [-0.30, 0.85, 0.30],
      look: 'rim', ev: ['plantR', 'fake'] }],
    // drops 10 cm, knees 60, snaps to a 25° lean, pushes the ball low and hard across
    [0.17, { P: [0, -0.17, 0, 15, 0, 0], RL: [45, 8, 0, 60, -15, 0], LL: [45, 8, 0, 60, -15, 0], S: [25, 0, 0], N: [-14, 0, 0], RA: [20, 5, 35, 75, 95, 35, 0], R: [0, 0.25, 0] }],
    [0.22, { Bp: [0.00, 0.12, 0.40], ev: 'bounce' }],
    // caught by the left hand outside the left knee; right shoulder dips and rotates toward the defender
    [0.27, { Bp: [0.32, 0.40, 0.38], B: 'L', LA: [20, 15, 15, 75, 90, 10, 0], LF: 'grip', RA: [25, 20, 10, 50, 40, 0, 0], RF: 'relax', RC: [-8, 15], ev: 'handOnL' }],
    [0.30, { Rft: null, RL: [40, 10, 10, 60, 10, 0] }],
    // left foot pushes off; right thigh drives across and forward; pelvis yaws 30 left; head level
    [0.33, { Lft: null, LL: [-5, 6, 0, 35, 30, 0], RL: [50, 10, 15, 60, 10, 0], P: [0, -0.15, 0, 15, 30, 0], N: [-10, 0, 0], RC: [0, 5], R: [0.25, 0.45, 10], look: 'rim' }],
    // long first step, left-hand dribble ahead of the left foot
    [0.47, { Rft: [0.55, 1.10, 30, 't'], RL: [40, 8, 0, 50, -10, 0], B: 'drib', ev: 'plantR' }],
    [0.50, { R: [0.70, 0.95, 25] }],
    [0.67, { S: [20, 0, 0], P: [0, -0.12, 0, 14, 25, 0], LL: [45, 6, 0, 70, 10, 0], R: [1.10, 1.60, 30] }],
  ]),
});

// ---------------------------------------------------------------------------------------------------------------
// Ky2 double between-the-legs (move; a shot input during 0.43–0.57 branches into the step-back jumper)
// ---------------------------------------------------------------------------------------------------------------
const doubleBtlStepback = defineClip({
  id: 'sig.kyrie.doubleBtlStepback', dur: 0.53, mask: 'full', root: 'motion', entry: 'carry', tempo: false, hand: 'R', cancel: 0.53, blendIn: 0.06, blendOut: 0.12,
  params: { cat: 'move', imm: [0.05, 0.53], freeze: 1.0, ankle: true, branch: [0.43, 0.57] },
  keys: relBall([
    // wide 0.70 base, LEFT foot forward
    [0.00, { Lft: [0.35, 0.25, 0, 't'], Rft: [-0.35, -0.10, 0, 't'], P: [0, -0.12, 0, 12, 0, 0], S: [20, 0, 0], N: [-20, 0, 0], RA: [25, 18, 10, 70, 90, 15, 0], LA: [20, 20, 0, 40, 20, 0, 0],
      RL: [15, 14, 0, 50, -15, 0], LL: [40, 14, 0, 55, -10, 0], B: 'path', Bp: [-0.30, 0.55, 0.25], RF: 'grip', R: [0, 0, 0], look: 'man' }],
    [0.10, { Bp: [0.02, 0.12, 0.05], RA: [10, 12, 30, 50, 95, 30, 0], P: [0, -0.15, 0, 13, 0, 0], ev: 'bounce' }],
    [0.20, { Bp: [0.30, 0.40, -0.15], LA: [10, 18, -10, 55, 90, 10, 0], LF: 'grip', RF: 'relax', P: [0, -0.09, 0, 12, 0, 0], ev: 'handOnL' }],
    // the left hand sends it back between the legs while the feet scissor (right foot forward)
    [0.23, { Lft: null, Rft: null, LL: [20, 12, 0, 45, 10, 0], RL: [35, 12, 0, 50, 0, 0] }],
    [0.30, { Bp: [-0.02, 0.12, 0.05], LA: [5, 14, 30, 50, 95, 30, 0], P: [0, -0.15, 0, 13, 0, 0], ev: 'bounce' }],
    [0.34, { Rft: [-0.35, 0.25, 0, 't'], Lft: [0.35, -0.10, 0, 't'], RL: [40, 14, 0, 55, -10, 0], LL: [15, 14, 0, 50, -15, 0] }],
    [0.40, { Bp: [-0.30, 0.40, -0.10], RA: [10, 18, -10, 55, 90, 10, 0], RF: 'grip', LF: 'relax', P: [0, -0.09, 0, 12, 0, 0], ev: 'handOnR' }],
    // jab 25 cm toward the defender, shoulders dip, ball low right
    [0.41, { Rft: null }],
    [0.43, { Rft: [-0.35, 0.50, 0, 't'], RL: [30, 12, 0, 40, -8, 0], S: [28, 0, 0], P: [0, -0.15, 0.04, 15, 0, 0], Bp: [-0.32, 0.35, 0.20], ev: ['plantR', 'fake'] }],
    [0.53, { Bp: [-0.32, 0.60, 0.25], B: 'drib', S: [24, 0, 0], P: [0, -0.13, 0.02, 14, 0, 0], R: [0, 0.10, 0] }],
  ]),
});

/** Shot branch (Ky2 from 0.57 on): hop back 0.80, land square 0.13/0.16, load, takeoff 0.26 (h 0.35), release 0.52. */
const dbT = { TO: 0.26, apex: 0.26 + th(0.35), tSet: 0.41, tRel: 0.52, tLand: 0.79, tEnd: 0.98 };
const doubleBtlStepbackShot = defineClip({
  id: 'sig.kyrie.doubleBtlStepbackShot', dur: 0.98, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h: 0.35 }, hand: 'R',
  cancel: 0.89, blendIn: 0.04, blendOut: 0.20, chain: true,
  params: { cat: 'jumper', meterFrom: 0, tIdeal: 0.47, METER_T: 0.59 },
  keys: [
    [0.00, { P: [0, -0.15, 0.04, 15, 0, 0], S: [26, 0, 0], N: [-18, 0, 0], ...SHORT.HIP_R, B: 'both', RF: 'grip', LF: 'grip', Rft: [-0.35, 0.50, 0, 't'], Lft: [0.35, -0.10, 0, 't'],
      RL: [30, 12, 0, 40, -8, 0], LL: [15, 14, 0, 50, -15, 0], R: [0, 0, 0], look: 'rim' }],
    // push-off and hop back (0.7–0.9)
    [0.03, { Rft: null, Lft: null, RL: [20, 8, 0, 40, 30, 0], LL: [20, 8, 0, 40, 30, 0], P: [0, -0.04, 0, 6, 0, 0], S: [10, 0, 0] }],
    [0.13, { Lft: [0.20, -0.80, 5, 'f'], LL: [40, 6, 4, 60, -20, 0], R: [0, -0.80, 0], ev: 'plantL' }],
    [0.16, { Rft: [-0.20, -0.80, 5, 'f'], RL: [40, 6, 4, 70, -25, 0], LL: [40, 6, 4, 70, -25, 0], P: [0, -0.10, 0, 10, 0, 0], ev: 'plantR' }],
    // load, knees 70; ball up along the chest
    [0.21, { P: [0, -F.dip, 0, 10, 0, 0], ...SHORT.CHEST, N: [-12, 0, 0] }],
    ...jumpTail('kyrie', dbT, { lean: 8, air: { R: [10, 20], L: [10, 20] }, land: { R: [-0.20, -0.95], L: [0.20, -0.98], yaw: 5 }, R: [0, -0.95, 0], armsTO: true }),
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// Ky3 reverse-pivot spin into a left-hand finish off the glass (root yaw +270 CCW)
// ---------------------------------------------------------------------------------------------------------------
const spinFinish = defineClip({
  id: 'sig.kyrie.spinFinish', dur: 1.40, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h: 0.50 }, meter: 'key', hand: 'R',
  cancel: 1.27, blendIn: 0.08, blendOut: 0.20,
  params: { cat: 'layup', meterFrom: 0.33, tIdeal: 0.77, METER_T: 0.55, gatherWindow: [0, 4.0] },
  keys: [
    [0.00, { P: [0, -0.08, 0, 12, 0, 0], S: [14, 0, 0], N: [-10, 0, 0], B: 'drib', RA: ARM.dribRun, LA: [35, 20, 0, 40, 10, 0, 0], RF: 'grip', RL: [30, 6, 0, 45, 10, 0],
      LL: [-5, 4, 0, 25, 25, 0], Rft: null, Lft: null, R: [0, 0, 0], look: 'rim' }],
    // hard plant ahead and across, knee 70: braking
    [0.10, { Lft: [0.20, 0.40, 30, 't'], LL: [40, 10, 0, 70, -20, 0], P: [0, -0.14, 0, 12, 0, 0], ev: 'plantL' }],
    // ball pulled to the right hip, palm on top; head turns over the left shoulder first
    [0.13, { B: 'R', RA: [25, 20, 30, 85, 100, -10, 0], N: [-10, 75, 0] }],
    [0.23, { R: [0.05, 0.42, 30], RL: [30, 35, 0, 60, 10, 0], RA: [25, 18, 30, 90, 100, -10, 0], LA: [30, 18, 20, 80, 20, 0, 0] }],
    // ball switches to the left hand at ≈ 200°
    [0.33, { B: 'L', LA: [25, 18, 25, 85, 80, -10, 0], LF: 'grip', RA: [30, 20, 10, 70, 20, 0, 0], RF: 'relax', R: [-0.05, 0.40, 180], N: [-10, 20, 0], ev: 'handoff' }],
    // right foot lands toward the rim; gather on a long step
    [0.43, { Rft: [-0.80, 0.28, 270, 'f'], RL: [40, 8, 0, 55, -15, 0], Lft: [0.20, 0.40, 300, 't'], B: 'both', ...SHORT.CHEST, LF: 'grip', P: [0, -0.16, 0, 10, 0, 0],
      R: [-0.30, 0.34, 270], N: [-12, 0, 0], ev: ['plantR', 'gather'] }],
    [0.46, { Lft: null, LL: [60, 6, 0, 80, 10, 0] }],
    // takeoff (right foot): left arm up, wrist under the ball; right arm shields at shoulder height
    [0.53, { Rft: null, RL: LEG.takeoff, LL: [90, 5, 0, 95, 30, 0], B: 'L', RF: 'relax', LA: [150, 15, 0, 25, -80, -30, 0], RA: [90, 60, 0, 60, 0, 0, 0], P: [0, -0.03, 0, 0, 0, 0],
      R: [-0.40, 0.34, 270], ev: 'takeoff' }],
    [0.53 + th(0.50), { ev: 'apex' }],
    // fingers roll it up off the glass
    [0.82, { LA: [170, 12, 0, 5, -80, 20, 0], B: 'free', E: { smirk: 0.2 }, ev: 'release' }],
    [0.92, { LA: [168, 12, 0, 5, -80, 30, 0], LF: 'relax' }],
    [1.17, { RL: LEG.layLand, LL: LEG.layLand, Rft: [-0.58, 0.34, 270, 'f'], Lft: [-0.22, 0.34, 270, 'f'], P: [0, -0.10, 0, 8, 0, 0], ev: 'land' }],
    [1.40, { ...SHORT.DOWN, P: [0, -0.05, 0, 5, 0, 0], S: [5, 0, 0], N: [0, 0, 0], E: { smirk: 0.4 } }],
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// Ky4 reverse layup with English along the right baseline; Ky5 floater / scoop
// ---------------------------------------------------------------------------------------------------------------
const reverseLay = defineClip({
  id: 'sig.kyrie.reverseLay', dur: 1.25, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h: 0.55 }, meter: 'key', hand: 'R',
  cancel: 1.14, blendIn: 0.08, blendOut: 0.20, target: 'plantR',
  params: { cat: 'layup', meterFrom: 0.20, tIdeal: 0.625, METER_T: 0.53, gatherWindow: [0.8, 4.0], bank: [0.30, 0.40] },
  keys: tplReverseLay({ s: 1, TO: 0.37, rel: 0.675, land: 1.04, end: 1.25, h: 0.55 }),
});

const floater = defineClip({
  id: 'sig.kyrie.floater', dur: 0.95, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h: 0.40 }, meter: 'key', hand: 'R',
  cancel: 0.84, blendIn: 0.06, blendOut: 0.20,
  params: { cat: 'layup', meterFrom: 0, tIdeal: 0.35, METER_T: 0.44, gatherWindow: [2.2, 4.5], arcDeg: 70 },
  keys: [...tplFloater({ TO: 0.17, rel: 0.40, land: 0.74, end: 0.95, h: 0.40 }, false), [0.74, { R: [0, 0.45, 0] }]],
});

const scoop = defineClip({
  id: 'sig.kyrie.scoop', dur: 0.90, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h: 0.30 }, meter: 'key', hand: 'R',
  cancel: 0.76, blendIn: 0.06, blendOut: 0.20,
  params: { cat: 'layup', meterFrom: 0, gatherWindow: [2.2, 4.5] },
  keys: [...tplFloater({ TO: 0.17, rel: 0.38, land: 0.66, end: 0.90, h: 0.30 }, true), [0.66, { R: [0, 0.40, 0] }]],
});

// ---------------------------------------------------------------------------------------------------------------
// Ky6 behind-the-back pull-up: hard two-foot stop, wrap to the left hand, re-hop, pull-up off two feet
// ---------------------------------------------------------------------------------------------------------------
const bbT = { TO: 0.45, apex: 0.45 + th(0.40), tSet: 0.606, tRel: 0.726, tLand: 1.02, tEnd: 1.25 };
const btbPullup = defineClip({
  id: 'sig.kyrie.btbPullup', dur: 1.25, mask: 'full', root: 'motion', entry: 'stop', entryDecel: 24, tempo: false, jump: { h: 0.40 }, hand: 'R',
  cancel: 1.12, blendIn: 0.06, blendOut: 0.20,
  params: { cat: 'jumper', meterFrom: 0.24, tIdeal: 0.676, METER_T: 0.54 },
  keys: relBall([
    // hard stop, both feet 0.60 wide
    [0.00, { Rft: [-0.30, 0.15, 0, 'f'], Lft: [0.30, 0.10, 0, 'f'], P: [0, -0.15, 0, 10, 0, 0], S: [12, 0, 0], N: [-10, 0, 0], RL: [40, 12, 0, 55, -15, 0], LL: [40, 12, 0, 55, -15, 0],
      RA: [30, 14, 15, 70, 90, 10, 0], LA: [30, 25, 0, 40, 10, 0, 0], B: 'path', Bp: [-0.30, 0.75, 0.25], RF: 'grip', R: [0, 0, 0], look: 'rim', ev: ['plantL', 'plantR'] }],
    // wraps behind the lumbar at pelvis height; bounce behind the heels
    [0.04, { RA: [-10, 30, -40, 70, 90, 20, 0] }],
    [0.08, { RA: [-30, 35, -55, 75, 90, 25, 0], Bp: [-0.25, 0.55, -0.20] }],
    [0.14, { Bp: [0.05, 0.12, -0.28], ev: 'bounce' }],
    [0.16, { RA: [-20, 30, -50, 60, 90, 25, 0] }],
    [0.22, { LA: [10, 20, 0, 60, 90, 10, 0], LF: 'grip', Bp: [0.30, 0.45, 0.05], RA: [20, 20, 0, 50, 30, 0, 0], RF: 'relax', ev: 'handOnL' }],
    // gathered off the left-hand bounce in 2 frames
    [0.24, { B: 'both', ...SHORT.CHEST, RF: 'grip', ev: 'gather' }],
    // small two-foot re-hop: pelvis up, feet re-lock in place
    [0.30, { Rft: null, Lft: null, P: [0, -0.11, 0, 8, 0, 0], RL: [30, 10, 0, 45, 20, 0], LL: [30, 10, 0, 45, 20, 0] }],
    [0.36, { Rft: [-0.30, 0.15, 0, 'f'], Lft: [0.30, 0.10, 0, 'f'], RL: [35, 10, 0, 50, -15, 0], LL: [35, 10, 0, 50, -15, 0], P: [0, -0.12, 0, 10, 0, 0] }],
    // dip → pull-up keys
    [0.40, { P: [0, -F.dip, 0, 10, 0, 0], S: [10, 0, 0], N: [-12, 0, 0], RL: [30, 6, 4, F.kneeDip, -(F.kneeDip - 30), 0], LL: [30, 6, 4, F.kneeDip, -(F.kneeDip - 30), 0] }],
    ...jumpTail('kyrie', bbT, { R: [0, 0, 0], land: { R: [-0.30, 0.15], L: [0.30, 0.10], yaw: 0 } }),
  ]),
});

// ---------------------------------------------------------------------------------------------------------------
// Celebrations ([ANIM §8.2])
// ---------------------------------------------------------------------------------------------------------------
const cels = [
  defineClip({
    id: 'cel.kyrie.holdFollow', dur: 1.50, mask: 'upper', layer: 'upper', root: 'none', tempo: false, hand: 'R', blendIn: 0.08, blendOut: 0.30, params: { cat: 'cel' },
    keys: [
      [0.00, { RA: [160, 4, 15, 0, 95, 70, 0], RF: 'snap', LA: guideUp(), E: { smirk: 0.3 }, look: 'man' }],
      [0.30, { E: { smirk: 0.8 } }],
      [1.20, { RA: [158, 4, 15, 0, 95, 70, 0], LA: [60, 25, 0, 40, 0, 0, 0] }],
      [1.50, { RA: [40, 15, 0, 40, 20, 0, 0], RF: 'relax', LA: [20, 15, 0, 30, 20, 0, 0], E: { smirk: 0.6 } }],
    ],
  }),
  defineClip({
    id: 'cel.kyrie.skyPoint', dur: 1.20, mask: 'upper', layer: 'upper', root: 'none', tempo: false, hand: 'R', blendIn: 0.08, blendOut: 0.30, params: { cat: 'cel' },
    keys: [
      [0.00, { RA: [40, 20, 0, 60, 0, 0, 0], LA: [20, 15, 0, 30, 20, 0, 0], N: [0, 0, 0] }],
      [0.10, { RA: [175, 10, 0, 10, -20, 0, 0], RF: 'point', N: [-20, 0, 0] }],
      [0.70, { RA: [173, 10, 0, 12, -20, 0, 0] }],
      // flat palm taps the chest over the heart
      [0.80, { RA: [40, 20, 0, 80, 0, 0, 0], RF: 'relax', LA: [45, -10, 55, 130, 0, 0, 0], LF: 'flat', N: [0, 0, 0] }],
      [0.90, { LA: [48, -10, 55, 135, 0, 0, 0] }],
      [1.20, { LA: [20, 15, 0, 30, 20, 0, 0], LF: 'relax', RA: [20, 15, 0, 40, 20, 0, 0], E: { smirk: 0.4 } }],
    ],
  }),
  defineClip({
    id: 'cel.kyrie.shh', dur: 1.20, mask: 'upper', layer: 'upper', root: 'none', tempo: false, hand: 'R', blendIn: 0.08, blendOut: 0.30, params: { cat: 'cel' },
    keys: [
      [0.00, { RA: [40, 20, 0, 60, 0, 0, 0], look: 'crowd' }],
      [0.20, { RA: [40, 10, 30, 140, -60, -10, 0], RF: 'shh', E: { smirk: 0.3 } }],
      [0.90, { RA: [40, 10, 30, 138, -60, -10, 0] }],
      [1.20, { RA: [20, 15, 0, 40, 20, 0, 0], RF: 'relax', E: { smirk: 0.5 } }],
    ],
  }),
  defineClip({
    id: 'cel.kyrie.walkAway', dur: 1.30, mask: 'full', root: 'motion', entry: 'replace', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.30, params: { cat: 'cel' },
    keys: [
      [0.00, { RC: [0, 0], LC: [0, 0], R: [0, 0, 0], RA: [20, 15, 0, 40, 20, 0, 0], LA: [20, 15, 0, 40, 20, 0, 0], E: { smirk: 0.3 }, look: 'none' }],
      // turns away (root yaw +150 over 0.40), then walks 1.2 m/s, relaxed shoulders
      [0.40, { R: [0.04, 0.05, 150], RC: [-5, 0], LC: [-5, 0], E: { smirk: 0.8 } }],
      [0.55, { RL: [20, 4, 0, 15, 0, 0], LL: [-10, 4, 0, 20, 10, 0], RA: [-10, 12, 0, 20, 10, 0, 0], LA: [20, 12, 0, 25, 10, 0, 0] }],
      [0.85, { RL: [-10, 4, 0, 20, 10, 0], LL: [20, 4, 0, 15, 0, 0], RA: [20, 12, 0, 25, 10, 0, 0], LA: [-10, 12, 0, 20, 10, 0, 0] }],
      [1.15, { RL: [20, 4, 0, 15, 0, 0], LL: [-10, 4, 0, 20, 10, 0], RA: [-10, 12, 0, 20, 10, 0, 0], LA: [20, 12, 0, 25, 10, 0, 0] }],
      [1.30, { R: [0.30, -0.50, 150], RL: [5, 2, 0, 8, 0, 0], LL: [5, 2, 0, 8, 0, 0] }],
    ],
  }),
  // after three straight makes: nod 20° held 0.3 s
  defineClip({
    id: 'cel.kyrie.bow', dur: 0.60, mask: 'upper', layer: 'upper', root: 'none', tempo: false, hand: 'R', blendIn: 0.08, blendOut: 0.20, params: { cat: 'cel' },
    keys: [
      [0.00, { N: [0, 0, 0], E: { smirk: 0.4 } }],
      [0.15, { N: [20, 0, 0] }],
      [0.45, { N: [20, 0, 0] }],
      [0.60, { N: [0, 0, 0], E: { smirk: 0.6 } }],
    ],
  }),
];

/** Guide hand "stays up 10 cm away" (his form) for the held follow-through. */
function guideUp() { const g = GUIDE('kyrie'); return [g[0] + 5, g[1] + 15, g[2] - 15, g[3] - 20, g[4] - 20, 0, 0]; }

// ---------------------------------------------------------------------------------------------------------------
// Idle habits ([ANIM §8.3])
// ---------------------------------------------------------------------------------------------------------------
const ST = STANCE.stand;
const standKey = { P: ST.P, S: ST.S, N: ST.N, RA: ST.RA, LA: ST.LA, RL: ST.RL, LL: ST.LL, Rft: ST.Rft, Lft: ST.Lft };
/** Ball wrap: B 'path' circle around the waist, r 0.30 at 1.2 Hz, hand-to-hand behind the back (2 laps in 1.6 s). */
function wrapKeys() {
  const out = [];
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const t = Math.min(1.6, 0.05 + i * (1.5 / n));
    const a = 2 * Math.PI * 1.2 * (t - 0.05);        // counter-clockwise from the front, viewed from above
    out.push([t, { Bp: [0.30 * Math.sin(a), 0.95, 0.30 * Math.cos(a)] }]);
  }
  return out;
}
const idles = [
  defineClip({
    id: 'idle.kyrie.ballWrap', dur: 1.6, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.15, blendOut: 0.20, params: { cat: 'idle' },
    keys: [
      [0.00, { ...standKey, ...SHORT.CHEST, B: 'path', Bp: [0, 0.95, 0.30], RF: 'grip', LF: 'grip', E: { smirk: 0.2 } }],
      ...wrapKeys(),
      [0.40, { RA: [-20, 30, -40, 60, 90, 10, 0], LA: [30, 30, 30, 80, 60, 0, 0] }],
      [0.65, { RA: [30, 30, 30, 80, 60, 0, 0], LA: [-20, 30, -40, 60, 90, 10, 0] }],
      [0.85, { RA: [-20, 30, -40, 60, 90, 10, 0], LA: [30, 30, 30, 80, 60, 0, 0] }],
      [1.10, { RA: [30, 30, 30, 80, 60, 0, 0], LA: [-20, 30, -40, 60, 90, 10, 0] }],
      [1.60, { ...SHORT.CHEST, B: 'both' }],
    ],
  }),
  defineClip({
    id: 'idle.kyrie.fingerSpin', dur: 1.4, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.15, blendOut: 0.20, params: { cat: 'idle', spin: true },
    keys: [
      [0.00, { ...standKey, ...SHORT.CHEST, B: 'path', Bp: [0, 1.05, 0.30], RF: 'grip', LF: 'grip', E: { smirk: 0.3 } }],
      // ball spins on the right index tip (0.14 above it)
      [0.20, { RA: [60, 20, 20, 110, -30, -20, 0], RF: 'point', LA: [30, 20, 0, 60, 30, 0, 0], LF: 'relax', Bp: [-0.12, 1.42, 0.30] }],
      [1.20, { RA: [60, 20, 20, 110, -30, -20, 0], Bp: [-0.12, 1.42, 0.30] }],
      [1.40, { ...SHORT.CHEST, RF: 'grip', LF: 'grip', B: 'both', Bp: [0, 1.05, 0.30] }],
    ],
  }),
  defineClip({
    id: 'idle.kyrie.handsHips', dur: 2.0, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.25, blendOut: 0.30, noRhythm: true, params: { cat: 'idle' },
    keys: [
      [0.00, { ...standKey }],
      [0.35, { RA: [20, 45, -35, 105, -30, -5, 0], LA: [20, 45, -35, 105, -30, -5, 0], RF: 'flat', LF: 'flat', N: [5, 0, 0] }],
      [1.70, { RA: [20, 45, -35, 105, -30, -5, 0], LA: [20, 45, -35, 105, -30, -5, 0], N: [3, -8, 0] }],
      [2.00, { ...standKey, RF: 'relax', LF: 'relax' }],
    ],
  }),
  defineClip({
    id: 'idle.kyrie.bounceWalk', dur: 1.6, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.20, blendOut: 0.25, params: { cat: 'idle' },
    keys: [
      [0.00, { ...standKey }],
      // light bounces on the toes in place, shoulders loose
      ...[0.20, 0.40, 0.60, 0.80, 1.00, 1.20, 1.40].map((t, i) => [t, {
        P: [0, i % 2 ? -0.02 : 0.01, 0, 3, 0, 0], RL: [5, 0, 0, i % 2 ? 10 : 4, i % 2 ? -3 : 10, 0], LL: [5, 0, 0, i % 2 ? 10 : 4, i % 2 ? -3 : 10, 0],
        RA: [i % 2 ? 8 : 2, 12, 0, 20, 10, 0, 0], LA: [i % 2 ? 2 : 8, 12, 0, 20, 10, 0, 0],
      }]),
      [1.60, { ...standKey }],
    ],
  }),
  defineClip({
    id: 'idle.kyrie.chestTap', dur: 1.0, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.25, params: { cat: 'idle' },
    keys: [
      [0.00, { ...standKey }],
      [0.25, { RA: [45, -10, 55, 130, 0, 0, 0], RF: 'flat' }],
      [0.35, { RA: [48, -10, 55, 135, 0, 0, 0] }], [0.45, { RA: [45, -10, 55, 128, 0, 0, 0] }], [0.55, { RA: [48, -10, 55, 135, 0, 0, 0] }],
      [0.70, { RA: [130, 10, 0, 20, -20, 0, 0], RF: 'point', N: [-15, 0, 0] }],
      [1.00, { RA: ST.RA, RF: 'relax', N: [0, 0, 0] }],
    ],
  }),
  defineClip({
    id: 'idle.kyrie.mouthguard', dur: 1.2, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.15, blendOut: 0.25, params: { cat: 'idle' },
    keys: [
      [0.00, { ...standKey, E: { jawOpen: 0 } }],
      // chews the mouthguard, lets it hang half out
      [0.20, { E: { jawOpen: 0.25 }, N: [5, 0, 0] }], [0.40, { E: { jawOpen: 0.05 } }], [0.60, { E: { jawOpen: 0.25 } }], [0.80, { E: { jawOpen: 0.05 } }],
      [1.00, { E: { jawOpen: 0.15 }, N: [0, 0, 0] }],
      [1.20, { E: { jawOpen: 0 } }],
    ],
  }),
];

/** Kyrie's clips (shared registrations). */
export const KYRIE_CLIPS = Object.freeze([
  hesiCross, doubleBtlStepback, doubleBtlStepbackShot, spinFinish, reverseLay, floater, scoop, btbPullup, ...cels, ...idles,
]);
