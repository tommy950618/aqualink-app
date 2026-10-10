/**
 * clips/yao.js — Yao Ming's signature clips, celebrations and idle habits (spec §4.11, §4.12, C8,
 * [ANIM §9.5 Y1–Y8, §8.2, §8.3]).
 *
 * Exports
 *   YAO_CLIPS  normalised ClipDefs (shared registrations; times final, tempo false):
 *     sig.yao.hook, sig.yao.turnFade, sig.yao.jabJumper, sig.yao.dropStep, sig.yao.dropStepLay, sig.yao.vertical,
 *     sig.yao.block, sig.yao.pumpHook, sig.yao.upUnder, sig.yao.overheadPass, sig.yao.rebound,
 *     cel.yao.fistPump, cel.yao.nod, cel.block.yaoPoint,
 *     idle.yao.handsKnees, idle.yao.waistband, idle.yao.handsHips, idle.yao.puff
 *
 * Yao's jumps are small; his post clips start from STANCE.postUp. The rim-protection and rebound jumps use GP hJump
 * (C8: 0.44 m) for their airtime, as select.js does; the drop-step dunk jumps 0.48 (two-hand need on our rig).
 * Times reproduce select.js: hook takeoff 0.60 / release 0.79 / land 1.02; turnaround takeoff 0.53 / set 0.67 /
 * release 0.749 / land 1.01; jab jumper takeoff 0.53 / set 0.535 / release 0.685; drop step slam 0.75, rim 0.78–0.88,
 * land 1.18; up-and-under takeoff 0.40, release 0.57, land 0.75.
 */
import { defineClip } from '../clip.js';
import { SET, GUIDE, REL, FOLLOW, SHORT, LEG, ARM, STANCE } from '../presets.js';
import { HJUMP } from '../select.js';
import { th, jumpTail, tplHook, tplUpUnder, relBall } from './shots.js';

const CHIN_Y = [40, 60, 30, 110, 15, -25, 0];            // chinned, elbows out (abd 60), forearm 110
const POST = { P: [0, -0.12, 0, 6, 0, 0], S: [15, 0, 0], N: [-8, -30, 0], RA: CHIN_Y, LA: CHIN_Y, RL: [35, 8, 0, 45, -10, 0], LL: [35, 8, 0, 45, -10, 0] };

// ---------------------------------------------------------------------------------------------------------------
// Y1 right-hand jump hook to the middle from the left block
// ---------------------------------------------------------------------------------------------------------------
const hook = defineClip({
  id: 'sig.yao.hook', dur: 1.50, mask: 'full', root: 'motion', entry: 'stop', entryDecel: 18, tempo: false, jump: { h: 0.22 }, meter: 'key', hand: 'R',
  cancel: 1.12, blendIn: 0.06, blendOut: 0.20,
  params: { cat: 'layup', meterFrom: 0.30, tIdeal: 0.74, METER_T: 0.55, baseSide: 'L', launchDeg: 55 },
  keys: tplHook({ s: 1, TO: 0.60, rel: 0.79, land: 1.02, end: 1.50, h: 0.22, contact: true }),
});

// ---------------------------------------------------------------------------------------------------------------
// Y2 turnaround fadeaway from the right block over the right shoulder (left-foot pivot, root yaw −160)
// ---------------------------------------------------------------------------------------------------------------
const tfT = { TO: 0.53, apex: 0.53 + th(0.28), tSet: 0.67, tRel: 0.749, tLand: 1.01, tEnd: 1.20 };
const turnFade = defineClip({
  id: 'sig.yao.turnFade', dur: 1.20, mask: 'full', root: 'motion', entry: 'stop', entryDecel: 18, tempo: false, jump: { h: 0.28 }, hand: 'R',
  cancel: 1.11, blendIn: 0.06, blendOut: 0.20, target: 'takeoff',
  params: { cat: 'jumper', meterFrom: 0.27, tIdeal: 0.699, METER_T: 0.54, baseSide: 'R', launchDeg: 50 },
  keys: [
    [0.00, { ...POST, Rft: [-0.38, 0, 0, 'f'], Lft: [0.37, 0, 0, 't'], B: 'both', RF: 'grip', LF: 'grip', look: 'none', R: [0, 0, 0] }],
    // head fake: yaw 25 left (fake middle); the ball dips 0.10
    [0.13, { N: [-8, 25, 0], S3: [null, 25, null], RA: [40, 60, 30, 120, 15, -25, 0], LA: [40, 60, 30, 120, 15, -25, 0] }],
    [0.27, { Rft: null, RL: [30, 25, 0, 55, 10, 0], N: [-8, 0, 0], S3: [null, 0, null], R: [0, 0, 0] }],
    [0.40, { R: [0.35, -0.03, -80], P: [0, -0.12, 0, 6, -10, 0] }],
    // square to the rim, thigh 45 load; ball up the midline chin → forehead
    [0.50, { R: [0.60, -0.09, -160], Lft: [0.37, 0, -160, 'f'], Rft: [0.84, -0.17, -160, 'f'], RL: [45, 6, 0, 55, -15, 0], LL: [45, 6, 0, 55, -15, 0], ...SHORT.CHIN, P: [0, -0.12, 0, 6, 0, 0], N: [-8, 0, 0], look: 'rim' }],
    [0.53, { Rft: null, Lft: null, RL: LEG.takeoff, LL: LEG.takeoff, P: [0, -0.03, 0, 2, 0, 0], RA: [100, 8, 18, 110, 80, -55, 0], LA: [95, 12, 40, 105, 15, -20, 0], ev: ['plantR', 'gather', 'takeoff'] }],
    [tfT.apex, { ev: 'apex' }],
    // set 0.15 above and 0.10 in front of the forehead, elbow 10° out; lean back 12 (spine_02 8, spine_03 4)
    [0.67, { RA: SET('yao'), LA: GUIDE('yao'), RF: 'shoot', S1: [0, 0, 0], S2: [-8, 0, 0], S3: [-4, 0, 0], RL: [15, 6, 0, 20, 30, 0], LL: [15, 6, 0, 20, 30, 0], ev: 'set' }],
    [0.749, { RA: REL('yao'), B: 'free', S2: [-8, 0, 0], S3: [-4, 0, 0], ev: 'release' }],
    // wrist flex 70 over 4 frames; the guide stays (no thumb flick), opens sideways at 0.85
    [0.88, { RA: FOLLOW('yao'), RF: 'snap' }],
    [0.85, { LA: [110, 30, 20, 85, 0, 0, 0] }],
    [1.01, { RL: [30, 6, 4, 35, -10, 0], LL: [30, 6, 4, 35, -10, 0], Rft: [0.93, 0.16, -160, 'f'], Lft: [0.51, 0.32, -160, 'f'], R: [0.72, 0.24, -160], P: [0, -0.08, 0, 6, 0, 0],
      S1: [2, 0, 0], S2: [2, 0, 0], S3: [2, 0, 0], ev: 'land' }],
    [1.10, { RA: [163, 4, 15, 0, 95, 75, 0] }],
    [1.20, { P: [0, -0.03, 0, 3, 0, 0], N: [0, 0, 0], ...SHORT.DOWN, RF: 'relax', LF: 'relax' }],
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// Y3 high-post jab jumper (0.30 m right-foot jab, gather 0.33–0.53, 0.15 rise, release at the apex, no fade)
// ---------------------------------------------------------------------------------------------------------------
const jjT = { TO: 0.53, apex: 0.53 + th(0.15), tSet: 0.535, tRel: 0.685, tLand: 0.88 };
jjT.tEnd = Math.max(jjT.tLand + 0.25, jjT.tRel + 0.60 + 0.15);
const TT = STANCE.tripleThreat;
const jabJumper = defineClip({
  id: 'sig.yao.jabJumper', dur: jjT.tEnd, mask: 'full', root: 'motion', entry: 'stop', entryDecel: 18, tempo: false, jump: { h: 0.15 }, hand: 'R',
  cancel: jjT.tLand + 0.10, blendIn: 0.06, blendOut: 0.20,
  params: { cat: 'jumper', meterFrom: 0.20, tIdeal: 0.635, METER_T: 0.54 },
  keys: [
    [0.00, { P: [0, -0.06, 0, 6, 0, 0], S: [8, 0, 0], N: [-10, 0, 0], ...SHORT.CHEST, RL: [20, 6, 0, 25, -6, 0], LL: [20, 6, 0, 25, -6, 0], Rft: [-0.29, 0.04, 8, 'f'],
      Lft: [0.29, -0.03, 8, 'f'], B: 'both', RF: 'grip', LF: 'grip', look: 'rim', R: [0, 0, 0] }],
    [0.03, { Rft: null, RL: [30, 6, 0, 40, 10, 0] }],
    // 0.30 m jab with a head / shoulder dip 10°
    [0.12, { Rft: [-0.29, 0.34, 0, 't'], RL: [25, 6, 0, 30, -5, 0], P: [0, -0.08, 0.03, 10, 0, 0], S: [18, 0, 0], N: [-20, 0, 0], ev: 'plantR' }],
    [0.20, { Rft: null, RL: [30, 6, 0, 40, 10, 0] }],
    [0.30, { Rft: [-0.29, 0.04, 8, 'f'], RL: [20, 6, 0, 25, -6, 0], P: [0, -0.06, 0, 6, 0, 0], S: [8, 0, 0], N: [-10, 0, 0] }],
    // gather 0.33–0.53 (ball at the chest, small dip)
    [0.33, { ev: 'gather' }],
    [0.45, { P: [0, -0.05, 0, 10, 0, 0], RL: [30, 6, 4, 30, 0, 0], LL: [30, 6, 4, 30, 0, 0], N: [-12, 0, 0] }],
    ...jumpTail('yao', jjT, { R: [0, 0, 0], air: { R: [10, 15], L: [10, 15] } }),
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// Y4 drop-step two-hand power dunk from the left block (root yaw −120) and its layup branch
// ---------------------------------------------------------------------------------------------------------------
const dropStart = (k) => [
  [0.00, { ...POST, N: [-8, 30, 0], Rft: [-0.38, 0, 0, 'f'], Lft: [0.37, 0, 0, 't'], B: 'both', RF: 'grip', LF: 'grip', look: 'none', R: [0, 0, 0] }],
  [0.05, { Rft: null, RL: [25, 25, -20, 50, 10, 0], P: [0, -0.14, 0, 8, -10, 0], N: [-10, 0, 0] }],
  // optional dribble between the feet
  [0.10, { B: 'path', Bp: [0.0, 0.85, 0.30], RA: [30, 25, 10, 80, 80, 0, 0] }],
  [0.13, { Bp: [0.05, 0.12, 0.05], ev: 'bounce' }],
  [0.20, { B: 'both', Bp: [0, 1.0, 0.30], RA: CHIN_Y }],
  // drop step 0.6 m back toward the baseline and rim, sealing with a 6° lean back
  [0.27, { R: [0.49, -0.21, -120], Rft: [0.62, -0.43, -120, 'f'], RL: [45, 8, 0, 55, -15, 0], S2: [-6, null, null], Lft: [0.37, 0, -120, 't'], look: 'rim', ev: ['plantR', 'gather'] }],
  [0.32, { Lft: null, LL: [40, 8, 0, 60, 15, 0] }],
  // two-foot power gather, feet 0.5 apart facing the rim, elbows out
  [0.42, { Lft: [0.25, -0.05, -120, 'f'], RL: [60, 8, 0, 70, -15, 0], LL: [60, 8, 0, 70, -15, 0], P: [0, -0.20, 0, 15, 0, 0], ...SHORT.CHEST, S: [10, 0, 0] }],
  [0.47, { Rft: null, Lft: null, RL: LEG.dunkTakeoff, LL: LEG.dunkTakeoff, P: [0, -0.03, 0, 2, 0, 0], S: [2, 0, 0], RA: [140, 15, 0, 40, 30, -20, 0], LA: [140, 15, 0, 40, 30, -20, 0], ev: 'takeoff' }],
  [0.47 + th(0.48), { ev: 'apex' }],
  ...k,
];
const DS_LAND = 0.47 + 0.71;
const dropStep = defineClip({
  id: 'sig.yao.dropStep', dur: 1.65, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h: 0.48, hang: 0.10 }, meter: false, hand: 'R',
  cancel: 1.40, blendIn: 0.10, blendOut: 0.25,
  params: { cat: 'dunk', hands: 2, gatherWindow: [0, 1.5] },
  keys: relBall(dropStart([
    [0.65, { RA: [170, 15, 0, 20, 30, -20, 0], LA: [170, 15, 0, 20, 30, -20, 0], RL: [25, 8, 0, 40, 30, 0], LL: [25, 8, 0, 40, 30, 0], E: { roar: 0.4 } }],
    [0.70, { RA: [170, 15, 0, 0, 40, -10, 0], LA: [170, 15, 0, 0, 40, -10, 0] }],
    // both hands drive it down, wrists flex 60
    [0.75, { RA: [150, 12, 0, 0, 90, 60, 0], LA: [150, 12, 0, 0, 90, 60, 0], B: 'free', S: [12, 0, 0], E: { roar: 0.8 }, ev: 'slam' }],
    [0.78, { RF: 'claw', RA: [148, 12, 0, 20, 90, 20, 0], P: [0, 0, 0, 5, 0, 0], ev: 'rimGrab' }],
    [0.88, { RF: 'relax', LF: 'relax', RA: [140, 15, 0, 40, 60, 0, 0], LA: [140, 15, 0, 40, 60, 0, 0], ev: 'rimRelease' }],
    // heavy landing (thigh 50)
    [DS_LAND, { RL: [50, 10, 0, 60, -15, 0], LL: [50, 10, 0, 60, -15, 0], Rft: [0.62, -0.43, -120, 'f'], Lft: [0.25, -0.05, -120, 'f'], P: [0, -0.15, 0, 14, 0, 0], S: [12, 0, 0],
      RA: [60, 25, 0, 60, 30, 0, 0], LA: [60, 25, 0, 60, 30, 0, 0], E: { roar: 0.9 }, ev: 'land' }],
    [1.65, { P: [0, -0.10, 0, 12, 0, 0], S: [18, 0, 0], RA: [35, 25, 0, 100, 0, 0, 0], LA: [35, 25, 0, 100, 0, 0, 0], RF: 'fist', LF: 'fist', E: { roar: 0.9 } }],
  ])),
});
const dropStepLay = defineClip({
  id: 'sig.yao.dropStepLay', dur: 1.40, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h: 0.48 }, meter: 'key', hand: 'R',
  cancel: 1.20, blendIn: 0.08, blendOut: 0.20,
  params: { cat: 'layup', meterFrom: 0.27, tIdeal: 0.73, gatherWindow: [0, 4.5] },
  keys: relBall(dropStart([
    [0.65, { RA: [165, 15, 0, 25, 30, -20, 0], LA: [160, 15, 0, 25, 30, -20, 0] }],
    // two-hand power layup off the glass at the apex
    [0.78, { RA: [170, 12, 0, 10, 60, 20, 0], LA: [165, 12, 0, 10, 60, 20, 0], B: 'free', E: { jawOpen: 0.4 }, ev: 'release' }],
    [0.88, { RA: [165, 12, 0, 10, 60, 30, 0], LA: [150, 20, 0, 30, 40, 0, 0], RF: 'relax', LF: 'relax' }],
    [0.47 + 2 * th(0.48), { RL: LEG.layLand, LL: LEG.layLand, Rft: [0.62, -0.43, -120, 'f'], Lft: [0.25, -0.05, -120, 'f'], P: [0, -0.12, 0, 10, 0, 0], ev: 'land' }],
    [1.40, { P: [0, -0.05, 0, 6, 0, 0], S: [8, 0, 0], ...SHORT.DOWN, E: { jawOpen: 0 } }],
  ])),
});

// ---------------------------------------------------------------------------------------------------------------
// Y5 verticality and block (rim protection in drop coverage; h = hJump 0.44, C8)
// ---------------------------------------------------------------------------------------------------------------
const HY = HJUMP.yao;
const rimJump = (id, cat, blocking) => {
  const TO = 0.13, apex = TO + th(HY), land = TO + 2 * th(HY), dur = land + 0.40;
  return defineClip({
    id, dur, mask: 'full', root: 'none', entry: 'stop', entryDecel: 30, tempo: false, jump: { h: HY }, hand: 'R', cancel: land + 0.05, blendIn: 0.05, blendOut: 0.20,
    params: { cat },
    keys: [
      [0.00, { P: [0, -0.07, 0, 6, 0, 0], S: [6, 0, 0], N: [-12, 0, 0], RA: [45, 45, 0, 60, -30, 0, 0], LA: [45, 45, 0, 60, -30, 0, 0], RL: LEG.defYao, LL: LEG.defYao, look: 'ball' }],
      // load
      [0.08, { P: [0, -0.10, 0, 6, 0, 0], RL: [35, 8, 0, 40, -12, 0], LL: [35, 8, 0, 40, -12, 0], RA: [120, 20, 0, 30, -60, 0, 0], LA: [120, 20, 0, 30, -60, 0, 0] }],
      // straight up, palms forward, body straight
      [TO, { P: [0, -0.02, 0, 0, 0, 0], S: [0, 0, 0], RL: LEG.takeoff, LL: LEG.takeoff, RA: ARM.vertical, LA: blocking ? [160, 15, 0, 5, -90, -10, 0] : ARM.vertical,
        RF: 'spread', LF: 'spread', ev: 'takeoff' }],
      [apex, { RL: LEG.verticalAir, LL: LEG.verticalAir, ev: 'apex' }],
      [land, { RL: LEG.contestLand, LL: LEG.contestLand, P: [0, -0.10, 0, 6, 0, 0], ev: 'land' }],
      // arms down to abd 90, head tracks the ball, turn and jog
      [land + 0.20, { RA: [60, 90, 0, 30, -30, 0, 0], LA: [60, 90, 0, 30, -30, 0, 0], RF: 'relax', LF: 'relax' }],
      [dur, { RA: [30, 90, 0, 30, -20, 0, 0], LA: [30, 90, 0, 30, -20, 0, 0], P: [0, -0.07, 0, 6, 0, 0], S: [6, 0, 0] }],
    ],
  });
};
// sig.yao.block: the blocking arm is the LEFT (vs a right-handed shooter) 15° forward of vertical, the other vertical
const vertical = rimJump('sig.yao.vertical', 'contest', false);
const block = rimJump('sig.yao.block', 'block', true);

// ---------------------------------------------------------------------------------------------------------------
// Y6 pump hook (move) + up-and-under (shot)
// ---------------------------------------------------------------------------------------------------------------
const pumpHook = defineClip({
  id: 'sig.yao.pumpHook', dur: 0.20, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.04, blendOut: 0.12, params: { cat: 'move' },
  keys: [
    [0.00, { RA: [110, 60, -20, 130, 60, -40, 0], LA: [90, 40, 30, 110, 0, -20, 0], B: 'both', RF: 'grip', LF: 'grip', N: [-12, 30, 0], RL: [40, 8, 0, 50, -12, 0], LL: [40, 8, 0, 50, -12, 0], look: 'rim' }],
    // ear → forehead → back; heels +0.04, head and eyes up
    [0.10, { RA: [140, 30, 0, 100, 80, -60, 0], LA: [110, 30, 20, 100, 10, -20, 0], RL: [30, 8, 0, 40, 8, 0], LL: [30, 8, 0, 40, 8, 0], N: [-25, 20, 0], P: [0, -0.06, 0, 4, 0, 0], ev: 'fake' }],
    [0.20, { RA: [110, 60, -20, 130, 60, -40, 0], LA: [90, 40, 30, 110, 0, -20, 0], RL: [40, 8, 0, 50, -12, 0], LL: [40, 8, 0, 50, -12, 0], N: [-12, 30, 0], P: [0, -0.10, 0, 6, 0, 0] }],
  ],
});
const upUnder = defineClip({
  id: 'sig.yao.upUnder', dur: 1.00, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h: 0.15 }, meter: 'key', hand: 'R',
  cancel: 0.85, blendIn: 0.06, blendOut: 0.20,
  params: { cat: 'layup', meterFrom: 0.10, tIdeal: 0.52, METER_T: 0.525, gatherWindow: [0, 3.0] },
  keys: tplUpUnder({ s: 1, TO: 0.40, rel: 0.57, land: 0.75, end: 1.00, h: 0.15 }),
});

// ---------------------------------------------------------------------------------------------------------------
// Y7 double-team overhead pass (release 0.25; 0.20 when already chinned — selectPass warps it)
// ---------------------------------------------------------------------------------------------------------------
const overheadPass = defineClip({
  id: 'sig.yao.overheadPass', dur: 0.60, mask: 'full', root: 'none', meter: false, tempo: false, hand: 'R', blendIn: 0.06, blendOut: 0.20, params: { cat: 'pass' },
  keys: [
    [0.00, { RA: CHIN_Y, LA: CHIN_Y, B: 'both', RF: 'grip', LF: 'grip', S: [6, 0, 0], N: [-10, 0, 0], Lft: null, LL: [25, 6, 0, 30, 5, 0], look: 'target' }],
    // ball overhead, both hands at the back of the ball, elbows 70
    [0.20, { RA: [165, 15, 0, 70, 30, -30, 0], LA: [165, 15, 0, 70, 30, -30, 0], S: [-4, 0, 0], N: [-12, 15, 0] }],
    // arms snap: upper arm 165 → 120, forearm 70 → 0, thumbs rotate down; left foot steps 0.20 toward the target
    [0.25, { RA: [120, 10, 0, 0, 90, 30, 0], LA: [120, 10, 0, 0, 90, 30, 0], S: [8, 0, 0], B: 'free', RF: 'spread', LF: 'spread', Lft: [0.20, 0.20, 0, 'f'], LL: [20, 6, 0, 25, -8, 0], ev: 'release' }],
    [0.40, { RA: [110, 10, 0, 0, 95, 45, 0], LA: [110, 10, 0, 0, 95, 45, 0] }],
    [0.60, { ...SHORT.DOWN, S: [4, 0, 0], N: [-5, 0, 0], RF: 'relax', LF: 'relax' }],
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// Y8 rebound from the box-out: small two-foot jump, both arms overhead, chin it with elbows flared 80, swivel
// ---------------------------------------------------------------------------------------------------------------
const RB = { TO: 0.10, apex: 0.10 + th(HY), land: 0.10 + 2 * th(HY) };
RB.dur = RB.land + 0.70;
const BO = STANCE.boxOut;
const rebound = defineClip({
  id: 'sig.yao.rebound', dur: RB.dur, mask: 'full', root: 'none', entry: 'stop', entryDecel: 30, tempo: false, jump: { h: HY }, hand: 'R', cancel: RB.land + 0.20,
  blendIn: 0.05, blendOut: 0.20, params: { cat: 'rebound' },
  keys: [
    [0.00, { P: BO.P, S: BO.S, N: BO.N, RA: BO.RA, LA: BO.LA, RL: LEG.boxOut, LL: LEG.boxOut, look: 'ball' }],
    [0.06, { P: [0, -0.14, 0, 14, 0, 0], RL: LEG.reboundLoad, LL: LEG.reboundLoad, RA: [100, 30, 0, 40, -40, 0, 0], LA: [100, 30, 0, 40, -40, 0, 0] }],
    [RB.TO, { P: [0, -0.03, 0, 4, 0, 0], S: [2, 0, 0], RL: LEG.takeoff, LL: LEG.takeoff, RA: [178, 10, 0, 5, -80, -10, 0], LA: [178, 10, 0, 5, -80, -10, 0], RF: 'spread', LF: 'spread', N: [-30, 0, 0], ev: 'takeoff' }],
    [RB.apex, { RL: LEG.reboundAir, LL: LEG.reboundAir, ev: 'apex' }],
    [RB.land, { P: [0, -0.12, 0, 10, 0, 0], RL: LEG.reboundLand, LL: LEG.reboundLand, RA: [120, 40, 20, 80, 0, -10, 0], LA: [120, 40, 20, 80, 0, -10, 0], RF: 'grip', LF: 'grip', ev: 'land' }],
    // chin it, elbows flared 80
    [RB.land + 0.20, { RA: ARM.chinItYao, LA: ARM.chinItYao, S: [10, 0, 0], N: [-10, 0, 0] }],
    [RB.land + 0.33, { S: [10, 10, 0] }], [RB.land + 0.47, { S: [10, -10, 0] }], [RB.land + 0.60, { S: [10, 0, 0] }],
    [RB.dur, { P: [0, -0.10, 0, 8, 0, 0], S: [10, 0, 0] }],
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// Celebrations ([ANIM §8.2])
// ---------------------------------------------------------------------------------------------------------------
const cels = [
  defineClip({
    id: 'cel.yao.fistPump', dur: 1.20, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.30, params: { cat: 'cel' },
    keys: [
      [0.00, { P: [0, -0.05, 0, 6, 0, 0], RA: [30, 25, 0, 80, 0, 0, 0], LA: [30, 25, 0, 80, 0, 0, 0], RL: [15, 8, 0, 20, -5, 0], LL: [15, 8, 0, 20, -5, 0], E: { roar: 0 }, look: 'crowd' }],
      // legs wide, torso flexed 20, both fists pumped down to hip height
      [0.10, { Rft: [-0.40, 0, -10, 'f'], Lft: [0.40, 0, 10, 'f'], RL: [25, 15, 0, 30, -8, 0], LL: [25, 15, 0, 30, -8, 0], P: [0, -0.10, 0, 10, 0, 0], S: [20, 0, 0], E: { roar: 0.9 } }],
      [0.20, { RA: [70, 25, 0, 110, 0, 0, 0], LA: [70, 25, 0, 110, 0, 0, 0], RF: 'fist', LF: 'fist' }],
      [0.30, { RA: [30, 25, 0, 100, 0, 0, 0], LA: [30, 25, 0, 100, 0, 0, 0] }],
      [0.45, { RA: [60, 25, 0, 100, 0, 0, 0], LA: [60, 25, 0, 100, 0, 0, 0] }],
      [0.60, { RA: [40, 25, 0, 90, 0, 0, 0], LA: [40, 25, 0, 90, 0, 0, 0] }],
      [1.10, { E: { roar: 0.9 }, S: [18, 0, 0] }],
      [1.20, { P: [0, -0.06, 0, 6, 0, 0], S: [8, 0, 0], RA: [20, 20, 0, 50, 10, 0, 0], LA: [20, 20, 0, 50, 10, 0, 0], RF: 'relax', LF: 'relax', E: { roar: 0.2, grin: 0.4 } }],
    ],
  }),
  // nod jog (N pitch +12 twice)
  defineClip({
    id: 'cel.yao.nod', dur: 1.00, mask: 'upper', layer: 'upper', root: 'none', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.30, params: { cat: 'cel' },
    keys: [
      [0.00, { N: [0, 0, 0], E: { grin: 0.2 } }],
      [0.25, { N: [12, 0, 0] }], [0.45, { N: [0, 0, 0] }], [0.65, { N: [12, 0, 0] }], [0.85, { N: [0, 0, 0], E: { grin: 0.5 } }],
      [1.00, { N: [0, 0, 0] }],
    ],
  }),
  // blocker: no taunt; turns, jogs and points to a teammate
  defineClip({
    id: 'cel.block.yaoPoint', dur: 0.90, mask: 'upper', layer: 'upper', root: 'none', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.30, params: { cat: 'cel' },
    keys: [
      [0.00, { RA: [40, 30, 0, 50, 0, 0, 0], S: [4, 0, 0], N: [-5, 0, 0], look: 'ball' }],
      [0.25, { S: [4, 20, 0], N: [-5, 30, 0] }],
      [0.40, { RA: [90, 35, 0, 10, 60, 0, 0], RF: 'point', E: { grin: 0.3 } }],
      [0.75, { RA: [88, 35, 0, 12, 60, 0, 0] }],
      [0.90, { RA: [30, 20, 0, 40, 20, 0, 0], RF: 'relax', S: [4, 0, 0], N: [0, 0, 0] }],
    ],
  }),
];

// ---------------------------------------------------------------------------------------------------------------
// Idle habits ([ANIM §8.3])
// ---------------------------------------------------------------------------------------------------------------
const ST = STANCE.stand;
const standKey = { P: ST.P, S: ST.S, N: ST.N, RA: ST.RA, LA: ST.LA, RL: ST.RL, LL: ST.LL, Rft: ST.Rft, Lft: ST.Lft };
const idles = [
  defineClip({
    id: 'idle.yao.handsKnees', dur: 2.4, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.30, blendOut: 0.30, params: { cat: 'idle' },
    keys: [
      [0.00, { ...standKey }],
      // straight arms on the knees, spine flex 40
      [0.45, { P: [0, -0.07, -0.05, 18, 0, 0], S: [40, 0, 0], N: [-35, 0, 0], RA: [50, 10, 10, 0, 30, 0, 0], LA: [50, 10, 10, 0, 30, 0, 0], RL: [25, 4, 0, 30, -8, 0], LL: [25, 4, 0, 30, -8, 0], E: { puff: 0.3 } }],
      [1.40, { S: [42, 0, 0], E: { puff: 0 } }],
      [2.00, { S: [40, 0, 0], P: [0, -0.07, -0.05, 18, 0, 0] }],
      [2.40, { ...standKey }],
    ],
  }),
  defineClip({
    id: 'idle.yao.waistband', dur: 0.8, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.20, params: { cat: 'idle' },
    keys: [
      [0.00, { ...standKey }],
      // both hands tug the shorts waistband
      [0.25, { RA: [25, 25, 40, 95, 30, -20, 0], LA: [25, 25, 40, 95, 30, -20, 0], RF: 'grip', LF: 'grip', N: [10, 0, 0] }],
      [0.45, { RA: [20, 25, 40, 90, 30, -25, 0], LA: [20, 25, 40, 90, 30, -25, 0], P: [0, -0.02, 0, 4, 0, 0] }],
      [0.80, { RA: ST.RA, LA: ST.LA, RF: 'relax', LF: 'relax', N: [0, 0, 0], P: ST.P }],
    ],
  }),
  defineClip({
    id: 'idle.yao.handsHips', dur: 2.0, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.25, blendOut: 0.30, noRhythm: true, params: { cat: 'idle' },
    keys: [
      [0.00, { ...standKey }],
      [0.35, { RA: [20, 45, -35, 105, -30, -5, 0], LA: [20, 45, -35, 105, -30, -5, 0], RF: 'flat', LF: 'flat', S: [0, 0, 0] }],
      [1.70, { RA: [20, 45, -35, 105, -30, -5, 0], LA: [20, 45, -35, 105, -30, -5, 0] }],
      [2.00, { ...standKey, RF: 'relax', LF: 'relax' }],
    ],
  }),
  defineClip({
    id: 'idle.yao.puff', dur: 0.6, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.20, params: { cat: 'idle' },
    keys: [
      [0.00, { E: { puff: 0 }, RC: [0, 0], LC: [0, 0] }],
      [0.15, { E: { puff: 0.8 }, RC: [4, 0], LC: [4, 0] }],
      [0.45, { E: { puff: 0.8 } }],
      [0.60, { E: { puff: 0 }, RC: [0, 0], LC: [0, 0] }],
    ],
  }),
];

/** Yao's clips (shared registrations). */
export const YAO_CLIPS = Object.freeze([
  hook, turnFade, jabJumper, dropStep, dropStepLay, vertical, block, pumpHook, upUnder, overheadPass, rebound, ...cels, ...idles,
]);
