/**
 * clips/giannis.js — Giannis Antetokounmpo's signature clips, celebrations and idle habits (spec §4.11, §4.12, C11,
 * [ANIM §9.4 G1–G5, §8.2, §8.3]).
 *
 * Exports
 *   GIANNIS_CLIPS  normalised ClipDefs (shared registrations; times final, tempo false):
 *     sig.giannis.euroDunk, sig.giannis.euroLay, sig.giannis.longGather, sig.giannis.spinGather, sig.giannis.helpBlock,
 *     sig.giannis.elbowDrive, cel.giannis.flexRoar, cel.giannis.airplane, cel.giannis.chestThump, cel.giannis.fingerUp,
 *     idle.giannis.handsHips, idle.giannis.bounceRoll, idle.giannis.faceWipe, idle.giannis.grin
 *
 * Times reproduce select.js: euro takeoff 0.83 (h 0.72), dunk slam 1.31 descending, rim 1.34–1.54, land 1.91 / layup
 * release 1.20, land 1.596; long gather takeoff 0.60, slam 1.067, rim 1.097–1.397, land 1.75; spin gather takeoff
 * 0.83, release 1.12, land 1.47; help block takeoff 0.15 (h 0.785). Root travel to the takeoff = select.js' nominal
 * toDist (press-window midpoint − takeoff distance) in authored metres (÷ sLeg 1.108); plants follow the root curve.
 */
import { defineClip } from '../clip.js';
import { SHORT, LEG, ARM, STANCE, SLEG } from '../presets.js';
import { th, tplEuro, rootAt, relBall, G, GRIP2, HAMMER2, JAB_HOLD, defineJump } from './shots.js';

const K = 1 / SLEG.giannis;                         // world metres → authored metres

// ---------------------------------------------------------------------------------------------------------------
// G1 Eurostep from the 3-pt line: dunk (slam descending at apex + 0.10) or layup (release at the apex)
// ---------------------------------------------------------------------------------------------------------------
const EU = { TO: 0.83, h: 0.72 };
const euroDunkLand = EU.TO + 0.48 + 0.03 + 0.20 + Math.sqrt(2 * (EU.h - 0.05) / G);
const euroDunk = defineJump({
  id: 'sig.giannis.euroDunk', dur: 2.21, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h: 0.72, hang: 0.20, descending: true },
  meter: false, hand: 'R', cancel: 2.0, blendIn: 0.10, blendOut: 0.25, target: 'takeoff',
  params: { cat: 'dunk', hands: 1, gatherWindow: [5.4, 7.6], dTO: 2.9, toDist: 3.60 },
  keys: tplEuro({ s: 1, TO: 0.83, slam: 1.31, land: euroDunkLand, end: 2.21, h: 0.72, hang: 0.20, steps: 1, toDist: 3.60 * K, air: (2.9 - 0.35) * K }, 'dunk'),
});
const euroLay = defineJump({
  id: 'sig.giannis.euroLay', dur: 1.90, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h: 0.72 }, meter: 'key', hand: 'R',
  cancel: 1.70, blendIn: 0.08, blendOut: 0.20, target: 'takeoff',
  params: { cat: 'layup', meterFrom: 0.60, tIdeal: 1.15, METER_T: 0.69, gatherWindow: [5.4, 7.6], dTO: 2.9, toDist: 3.60 },
  keys: tplEuro({ s: 1, TO: 0.83, rel: 1.20, land: 0.83 + 2 * th(0.72), end: 1.90, h: 0.72, steps: 1, toDist: 3.60 * K, air: (2.9 - 0.45) * K }, 'lay'),
});

// ---------------------------------------------------------------------------------------------------------------
// G2 long-gather two-hand power dunk in transition (h 0.66, slam descending at apex + 0.10, hang 0.30)
// ---------------------------------------------------------------------------------------------------------------
const LG = { TO: 0.60, h: 0.66, slam: 1.067, hang: 0.30 };
LG.land = LG.slam + 0.03 + LG.hang + Math.sqrt(2 * (LG.h - 0.05) / G);
const lgRk = [[0, { R: [0, 0, 0] }], [0.60, { R: [0, 4.20 * K, 0] }], [1.067, { R: [0, (4.20 + 2.55) * K, 0] }]];
const lz = (t) => rootAt(lgRk, t)[1];
const longGather = defineJump({
  id: 'sig.giannis.longGather', dur: 2.05, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h: 0.66, hang: 0.30, descending: true },
  meter: false, hand: 'R', cancel: 1.85, blendIn: 0.10, blendOut: 0.25, target: 'takeoff',
  params: { cat: 'dunk', hands: 2, gatherWindow: [6.4, 7.8], dTO: 2.9, toDist: 4.20, gather: [5.0, 5.4] },
  keys: [
    ...lgRk,
    // last dribble at full sprint (stride 2.1)
    [0.00, { P: [0, -0.10, 0, 12, 0, 0], S: [15, 0, 0], N: [-14, 0, 0], B: 'drib', RA: ARM.dribSpeed, LA: [-20, 15, 0, 80, 10, 0, 0], RF: 'grip', RL: [-10, 6, 0, 30, 30, 0],
      LL: [55, 6, 0, 80, 10, 0], Rft: null, Lft: null, look: 'rim' }],
    [0.27, { B: 'both', ...SHORT.HIP_R, LF: 'grip', Rft: [-0.12, lz(0.27) + 0.30, 0, 'f'], RL: [30, 6, 0, 40, -10, 0], LL: [30, 6, 0, 80, 25, 0], ev: ['gather', 'plantR'] }],
    [0.36, { Rft: null, RL: [10, 6, 0, 45, 30, 0], LL: [50, 6, 0, 60, 0, 0] }],
    [0.40, { ...SHORT.CHEST }],
    // long right step into the LEFT plant, deep load
    [0.53, { Lft: [0.12, lz(0.53) + 0.30, 0, 'f'], LL: [50, 6, 0, 70, -15, 0], RL: [40, 6, 0, 80, 20, 0], P: [0, -0.27, 0, 6, 0, 0], S: [10, 0, 0], ev: 'plantL' }],
    // hips and knees extend; ball swung up the midline overhead
    [0.60, { Lft: null, LL: LEG.dunkTakeoff, RL: [60, 6, 0, 70, 30, 0], RA: [160, -5, 20, 30, 30, -20, 0], LA: [160, -5, 20, 30, 30, -20, 0], P: [0, -0.03, 0, 0, 0, 0], S: [0, 0, 0], ev: 'takeoff' }],
    // ball behind the head at neck level, knees tuck, roar builds
    [0.80, { RA: GRIP2.cock, LA: GRIP2.cock, S2: [-12, 0, 0], S3: [-12, 0, 0], S1: [0, 0, 0], N: [-10, 0, 0], RL: LEG.dunkTuck, LL: LEG.dunkTuck, E: { roar: 0.4 } }],
    [LG.TO + th(LG.h), { ev: 'apex' }],
    [1.03, { S1: [0, 0, 0], S2: [2, 0, 0], S3: [2, 0, 0], RA: GRIP2.slam, LA: GRIP2.slam, RC: [10, 0], LC: [10, 0] }],
    [1.067, { RA: GRIP2.slam, LA: GRIP2.slam, B: 'free', E: { roar: 1.0 }, ev: 'slam' }],
    [1.13, { S1: [10, 0, 0], S2: [12, 0, 0], S3: [10, 0, 0], RA: HAMMER2, LA: HAMMER2, RC: [0, 0], LC: [0, 0] }],
    // both hands on the rim, elbows bend 30 (slight pull-up); legs swing forward, knees lift and apart
    [1.097, { RF: 'claw', LF: 'claw', RA: [145, 15, 0, 30, 90, 20, 0], LA: [145, 15, 0, 30, 90, 20, 0], ev: 'rimGrab' }],
    [1.20, { RL: [60, 15, 0, 80, 20, 0], LL: [60, 15, 0, 80, 20, 0] }],
    [1.397, { RA: [140, 15, 0, 40, 60, 0, 0], LA: [140, 15, 0, 40, 60, 0, 0], RF: 'relax', LF: 'relax', ev: 'rimRelease' }],
    [LG.land, { RL: LEG.dunkLand, LL: LEG.dunkLand, Rft: [-0.25, lz(1.067) + 0.10, 0, 'f'], Lft: [0.25, lz(1.067) + 0.10, 0, 'f'], P: [0, -0.15, 0, 14, 0, 0], S: [12, 0, 0],
      RA: [60, 30, 0, 70, 0, 0, 0], LA: [60, 30, 0, 70, 0, 0, 0], ev: 'land' }],
    [2.05, { P: [0, -0.08, 0, 10, 0, 0], S: [12, 0, 0], N: [-10, 0, 0], RA: [0, 80, -60, 100, -60, 0, 0], LA: [0, 80, -60, 100, -60, 0, 0], RF: 'fist', LF: 'fist', E: { roar: 0.8 } }],
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// G3 reverse spin gather (root yaw +300 CCW on the left forefoot) into a left-hand finger roll
// ---------------------------------------------------------------------------------------------------------------
const spinGather = defineJump({
  id: 'sig.giannis.spinGather', dur: 1.70, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h: 0.50 }, meter: 'key', hand: 'R',
  cancel: 1.57, blendIn: 0.08, blendOut: 0.20, target: 'plantR',
  params: { cat: 'layup', meterFrom: 0.63, tIdeal: 1.07, METER_T: 0.55, gatherWindow: [0, 4.0] },
  keys: [
    [0.00, { P: [0, -0.12, 0, 12, 0, 0], S: [14, 0, 0], N: [-12, 0, 0], B: 'drib', RA: ARM.dribRun, LA: [35, 20, 0, 40, 10, 0, 0], RF: 'grip', RL: [30, 6, 0, 45, 10, 0],
      LL: [-5, 4, 0, 25, 25, 0], Rft: null, Lft: null, R: [0, 0, 0], look: 'rim' }],
    // hard plant, toes 30° right of travel; gather at the right hip
    [0.23, { Lft: [0.25, 0.40, 30, 't'], LL: [40, 8, 0, 60, -15, 0], P: [0, -0.18, 0, 10, 0, 0], B: 'both', ...SHORT.HIP_R, LF: 'grip', R: [0, 0.25, 0], ev: ['plantL', 'gather'] }],
    // head whips round first to spot the rim
    [0.33, { N: [-10, 75, 0], R: [0.05, 0.30, 90], RL: [30, 30, 0, 70, 10, 0], RA: GRIP2.hipTight, LA: GRIP2.hipTight }],
    [0.48, { N: [-10, 30, 0], R: [-0.10, 0.45, 200] }],
    // right foot lands ≈ 1.4 m past the defender's hip toward the rim
    [0.63, { Rft: [-0.87, 0.87, 300, 'f'], RL: [40, 8, 0, 55, -15, 0], Lft: [0.25, 0.40, 330, 't'], R: [-0.31, 0.64, 300], N: [-12, 0, 0], ev: 'plantR' }],
    [0.66, { Lft: null }],
    // load on the right foot, left knee drives up
    [0.76, { RA: GRIP2.hipTight, LA: GRIP2.hipTight }],
    [0.80, { LL: [90, 5, 0, 100, 20, 0], RL: [45, 6, 0, 65, -18, 0], P: [0, -0.14, 0, 8, 0, 0], B: 'L', RF: 'relax' }],
    // takeoff off the RIGHT foot; the ball rises up the left side
    [0.83, { Rft: null, RL: [-10, 3, 0, 10, 40, 0], LL: [95, 5, 0, 100, 30, 0], LA: [150, 15, 0, 30, -60, -20, 0], B: 'L', RF: 'relax', P: [0, -0.03, 0, 0, 0, 0], ev: 'takeoff' }],
    [1.12, { LA: [170, 10, 0, 5, -70, 15, 0], B: 'free', RA: [80, 40, 0, 60, 0, 0, 0], E: { jawOpen: 0.3 }, ev: 'release' }],
    [0.83 + th(0.50), { ev: 'apex' }],
    [1.22, { LA: [168, 10, 0, 5, -70, 30, 0] }],
    [1.47, { RL: LEG.layLand, LL: LEG.layLand, Rft: [-0.47, 0.71, 300, 'f'], Lft: [-0.15, 0.53, 300, 'f'], P: [0, -0.10, 0, 8, 0, 0], ev: 'land' }],
    [1.70, { ...SHORT.DOWN, LF: 'relax', P: [0, -0.05, 0, 5, 0, 0], S: [5, 0, 0], N: [0, 0, 0], E: { jawOpen: 0, grin: 0.3 } }],
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// G4 help / chase-down block: inside arm straight up, pin with a 40° wrist flex (h 0.785, peak at takeoff + 0.40)
// ---------------------------------------------------------------------------------------------------------------
const HB = { TO: 0.15, h: 0.785 };
HB.apex = HB.TO + th(HB.h); HB.land = HB.TO + 2 * th(HB.h); HB.dur = HB.land + 0.35;
const helpBlock = defineJump({
  id: 'sig.giannis.helpBlock', dur: HB.dur, mask: 'full', root: 'motion', entry: 'carry', entryDecel: 30, tempo: false, jump: { h: 0.785 }, hand: 'R',
  cancel: HB.land + 0.05, blendIn: 0.05, blendOut: 0.20, params: { cat: 'block', pin: true },
  keys: [
    // stutter, then the left-foot penultimate
    [0.00, { Rft: [-0.12, 0, 0, 'f'], Lft: null, P: [0, -0.22, 0, 8, 0, 0], S: [10, 0, 0], N: [-15, 0, 0], RA: [30, 20, 0, 70, 0, 0, 0], LA: [30, 20, 0, 70, 0, 0, 0],
      RL: [35, 8, 0, 60, -15, 0], LL: [50, 8, 0, 75, 10, 0], R: [0, 0, 0], look: 'ball', E: { jawOpen: 0.3 }, ev: 'plantR' }],
    [0.08, { Lft: [0.12, 0.25, 0, 'f'], LL: [40, 8, 0, 60, -15, 0], Rft: null, RL: [45, 8, 0, 75, 20, 0], ev: 'plantL' }],
    // takeoff off the LEFT foot: inside arm straight up, palm toward the ball; other arm down and back
    [0.15, { Lft: null, LL: LEG.takeoff, RL: [70, 6, 0, 80, 30, 0], RA: [175, 10, 0, 0, -90, -15, 0], RF: 'spread', LA: [-20, 40, 0, 20, 0, 0, 0],
      S2: [null, null, -15], S3: [null, null, -15], N: [-25, 0, 0], P: [0, -0.03, 0, 2, 0, 0], ev: 'takeoff' }],
    [HB.apex, { RA: [176, 10, 0, 0, -90, -15, 0], ev: 'apex' }],
    // legs split as the body drifts past the rim
    [0.70, { RL: [80, 10, 0, 60, 30, 0], LL: [-10, 5, 0, 15, 40, 0], RA: [160, 15, 0, 15, -60, 10, 0] }],
    [HB.land, { LL: [35, 8, 0, 45, -12, 0], RL: [60, 10, 0, 50, 10, 0], P: [0, -0.14, 0, 12, 0, 0], RA: [110, 20, 0, 30, 0, 0, 0], ev: 'land' }],
    [1.02, { RL: [35, 8, 0, 45, -12, 0] }],
    [1.15, { RA: [60, 30, 0, 100, 0, 0, 0], LA: [60, 30, 0, 100, 0, 0, 0], RF: 'fist', LF: 'fist', E: { roar: 0.6 } }],
    [HB.dur, { P: [0, -0.10, 0, 8, 0, 0], S: [8, 0, 0], N: [-8, 0, 0], RA: [40, 30, 0, 100, 0, 0, 0], LA: [40, 30, 0, 100, 0, 0, 0], E: { roar: 1.0 } }],
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// G5 elbow drive: jab, one left-hand crossover with a 1.9 m stride, gather on the left, 1.8 m right step
// ---------------------------------------------------------------------------------------------------------------
const TT = STANCE.tripleThreat;
const edRk = [[0, { R: [0, 0, 0] }], [0.20, { R: [0, 0, 0] }], [0.50, { R: [0.25, 1.55, 0] }], [0.83, { R: [0.20, 3.75, 0] }]];
const elbowDrive = defineClip({
  id: 'sig.giannis.elbowDrive', dur: 0.83, mask: 'full', root: 'motion', entry: 'replace', tempo: false, hand: 'R', blendIn: 0.06, blendOut: 0.12,
  target: 'plantR', params: { cat: 'move' },
  keys: relBall([
    ...edRk,
    [0.00, { P: TT.P, S: TT.S, N: TT.N, ...JAB_HOLD, RL: TT.RL, LL: TT.LL, Rft: [-0.29, 0.04, 8, 'f'], Lft: [0.29, -0.03, 8, 'f'], B: 'both', RF: 'grip', LF: 'grip', look: 'man' }],
    [0.03, { Rft: null, RL: [35, 6, 0, 55, 10, 0] }],
    // jab 0.4 with a head fake right
    [0.10, { Rft: [-0.29, 0.44, 0, 't'], RL: [30, 6, 0, 35, -5, 0], P: [0, -0.155, 0.05, 16, 0, 0], N: [-24, -10, 0], ev: 'fake' }],
    [0.15, { Rft: null, RL: [35, 6, 0, 50, 10, 0] }],
    [0.20, { Rft: [-0.29, 0.04, 8, 'f'], RL: TT.RL, P: TT.P, N: TT.N, ...JAB_HOLD }],
    [0.28, { Rft: null, RL: [20, 6, 0, 50, 25, 0] }],
    // crossover dribble hand_r → hand_l at knee height
    [0.23, { B: 'path', Bp: [-0.25, 0.75, 0.30], RA: [25, 15, 30, 70, 95, 25, 0], Lft: null, LL: [40, 6, 0, 70, 20, 0], P: [0, -0.15, 0, 18, 0, 0], S: [22, 0, 0] }],
    [0.30, { Bp: [0, 0.12, 0.50], ev: 'bounce' }],
    [0.40, { Bp: [0.30, 0.50, 0.35], LA: [25, 15, 15, 70, 90, 10, 0], LF: 'grip', RA: [30, 20, 0, 50, 20, 0, 0], RF: 'relax' }],
    // left foot strides 1.9 m past the defender's left hip
    [0.50, { Lft: [0.40, 1.95, 0, 't'], LL: [40, 6, 0, 50, -12, 0], RL: [20, 6, 0, 60, 30, 0], ev: 'plantL' }],
    [0.53, { B: 'both', ...SHORT.HIP_R, RF: 'grip', ev: 'gather' }],
    [0.62, { Lft: null, LL: [10, 6, 0, 50, 30, 0], RL: [60, 6, 0, 70, 5, 0] }],
    // one more 1.8 m right-foot step → finish clip (target-matched)
    [0.83, { Rft: [0.02, 3.85, 0, 'f'], RL: [40, 6, 0, 55, -15, 0], P: [0, -0.14, 0, 10, 0, 0], S: [14, 0, 0], ev: 'plantR' }],
  ]),
});

// ---------------------------------------------------------------------------------------------------------------
// Celebrations ([ANIM §8.2])
// ---------------------------------------------------------------------------------------------------------------
const BICEPS = [0, 90, -80, 110, -60, 0, 0];               // double-biceps flex (upper arms abducted 90, elbows 110)
const cels = [
  defineClip({
    id: 'cel.giannis.flexRoar', dur: 1.40, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.30, noRhythm: true, params: { cat: 'cel' },
    keys: [
      [0.00, { P: [0, -0.08, 0, 8, 0, 0], RA: [40, 40, 0, 80, 0, 0, 0], LA: [40, 40, 0, 80, 0, 0, 0], RL: [15, 8, 0, 20, -5, 0], LL: [15, 8, 0, 20, -5, 0], E: { roar: 0.15 }, look: 'crowd' }],
      // feet 1.0 apart, knees 20; torso leans 15° toward the crowd; roar
      [0.15, { Rft: [-0.50, 0, -10, 'f'], Lft: [0.50, 0, 10, 'f'], RL: [18, 18, 0, 20, -5, 0], LL: [18, 18, 0, 20, -5, 0], P: [0, -0.10, 0, 8, 0, 0] }],
      [0.30, { RA: BICEPS, LA: BICEPS, RF: 'fist', LF: 'fist', S: [15, 0, 0], N: [-20, 0, 0], E: { roar: 1.0 } }],
      [0.95, { RA: BICEPS, LA: BICEPS }],
      // two short downward fist pumps (elbow 110 → 80 → 110)
      [1.05, { RA: [0, 90, -80, 80, -60, 0, 0], LA: [0, 90, -80, 80, -60, 0, 0] }],
      [1.15, { RA: BICEPS, LA: BICEPS }],
      [1.25, { RA: [0, 90, -80, 80, -60, 0, 0], LA: [0, 90, -80, 80, -60, 0, 0] }],
      [1.40, { RA: [10, 60, -40, 100, -40, 0, 0], LA: [10, 60, -40, 100, -40, 0, 0], E: { roar: 0.6 } }],
    ],
  }),
  defineClip({
    id: 'cel.giannis.airplane', dur: 1.20, mask: 'upper', layer: 'upper', root: 'none', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.30, params: { cat: 'cel' },
    keys: [
      [0.00, { RA: [20, 30, 0, 30, 0, 0, 0], LA: [20, 30, 0, 30, 0, 0, 0], S: [0, 0, 0], E: { grin: 0.3 } }],
      // arms out like wings, spine roll ±10° at 1 Hz
      [0.20, { RA: [0, 85, 0, 10, -30, 0, 0], LA: [0, 85, 0, 10, -30, 0, 0], RF: 'flat', LF: 'flat', E: { grin: 0.7 } }],
      [0.45, { S: [0, 0, 10] }], [0.95, { S: [0, 0, -10] }],
      [1.20, { S: [0, 0, 0], RA: [20, 40, 0, 30, 0, 0, 0], LA: [20, 40, 0, 30, 0, 0, 0], RF: 'relax', LF: 'relax', E: { grin: 0.5 } }],
    ],
  }),
  defineClip({
    id: 'cel.giannis.chestThump', dur: 0.90, mask: 'upper', layer: 'upper', root: 'none', tempo: false, hand: 'R', blendIn: 0.08, blendOut: 0.30, params: { cat: 'cel' },
    keys: [
      [0.00, { RA: [40, 20, 0, 80, 0, 0, 0], E: { roar: 0.3 } }],
      // two quick right-fist hits to the left pec, then point at a teammate
      [0.18, { RA: [50, -10, 55, 125, 0, 0, 0], RF: 'fist' }],
      [0.25, { RA: [55, -10, 60, 135, 0, 0, 0], E: { roar: 0.6 } }],
      [0.35, { RA: [50, -10, 55, 120, 0, 0, 0] }],
      [0.45, { RA: [55, -10, 60, 135, 0, 0, 0] }],
      [0.65, { RA: [90, 25, 0, 10, 60, 0, 0], RF: 'point', E: { grin: 0.5, roar: 0 } }],
      [0.90, { RA: [85, 25, 0, 15, 60, 0, 0] }],
    ],
  }),
  defineClip({
    id: 'cel.giannis.fingerUp', dur: 1.00, mask: 'upper', layer: 'upper', root: 'none', tempo: false, hand: 'R', blendIn: 0.08, blendOut: 0.30, params: { cat: 'cel' },
    keys: [
      [0.00, { RA: [40, 20, 0, 70, 0, 0, 0], E: { grin: 0.2 } }],
      [0.18, { RA: [150, 15, 0, 20, -30, 0, 0], RF: 'point', E: { grin: 0.5 } }],
      [0.80, { RA: [148, 15, 0, 22, -30, 0, 0] }],
      [1.00, { RA: [40, 15, 0, 40, 20, 0, 0], RF: 'relax' }],
    ],
  }),
];

// ---------------------------------------------------------------------------------------------------------------
// Idle habits ([ANIM §8.3])
// ---------------------------------------------------------------------------------------------------------------
const ST = STANCE.stand;
const standKey = { P: ST.P, S: ST.S, N: ST.N, RA: ST.RA, LA: ST.LA, RL: ST.RL, LL: ST.LL, Rft: ST.Rft, Lft: ST.Lft };
const HIPS = [20, 45, -35, 105, -30, -5, 0];
const idles = [
  defineClip({
    id: 'idle.giannis.handsHips', dur: 2.0, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.25, blendOut: 0.30, noRhythm: true, params: { cat: 'idle' },
    keys: [
      [0.00, { ...standKey }],
      // long fingers spread over the hip bones, head nods
      [0.35, { RA: HIPS, LA: HIPS, RF: 'flat', LF: 'flat' }],
      [0.80, { N: [10, 0, 0] }], [1.10, { N: [-2, 0, 0] }], [1.40, { N: [10, 0, 0] }], [1.70, { N: [0, 0, 0], RA: HIPS, LA: HIPS }],
      [2.00, { ...standKey, RF: 'relax', LF: 'relax' }],
    ],
  }),
  defineClip({
    id: 'idle.giannis.bounceRoll', dur: 2.0, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.25, blendOut: 0.30, noRhythm: true, params: { cat: 'idle' },
    keys: [
      [0.00, { ...standKey, RC: [0, 0], LC: [0, 0] }],
      // toe bounce at 2 Hz with shoulder rolls
      ...[0.25, 0.50, 0.75, 1.00, 1.25, 1.50, 1.75].map((t, i) => [t, {
        P: [0, i % 2 ? -0.01 : 0.015, 0, 3, 0, 0], RL: [3, 0, 0, i % 2 ? 8 : 4, i % 2 ? -2 : 10, 0], LL: [3, 0, 0, i % 2 ? 8 : 4, i % 2 ? -2 : 10, 0],
        RC: [i % 4 < 2 ? 6 : 0, i % 4 === 1 ? 6 : -3], LC: [i % 4 < 2 ? 0 : 6, i % 4 === 3 ? 6 : -3],
      }]),
      [2.00, { ...standKey, RC: [0, 0], LC: [0, 0] }],
    ],
  }),
  defineClip({
    id: 'idle.giannis.faceWipe', dur: 0.8, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.20, params: { cat: 'idle' },
    keys: [
      [0.00, { ...standKey }],
      // back of the right hand wipes the beard / face
      [0.25, { RA: [100, 10, 45, 150, 90, 0, 0], RF: 'flat', N: [-5, 10, 0] }],
      [0.45, { RA: [105, 25, 30, 145, 90, 0, 0], N: [-5, -5, 0] }],
      [0.80, { RA: ST.RA, RF: 'relax', N: [0, 0, 0] }],
    ],
  }),
  defineClip({
    id: 'idle.giannis.grin', dur: 1.5, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.20, blendOut: 0.30, params: { cat: 'idle' },
    keys: [
      [0.00, { E: { grin: 0 }, N: [0, 0, 0] }],
      [0.30, { E: { grin: 0.8 }, N: [-4, 5, 0] }],
      [1.20, { E: { grin: 0.8 }, N: [-3, 0, 0] }],
      [1.50, { E: { grin: 0.4 }, N: [0, 0, 0] }],
    ],
  }),
];

/** Giannis' clips (shared registrations). */
export const GIANNIS_CLIPS = Object.freeze([
  euroDunk, euroLay, longGather, spinGather, helpBlock, elbowDrive, ...cels, ...idles,
]);
