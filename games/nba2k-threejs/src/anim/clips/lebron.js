/**
 * clips/lebron.js — LeBron James' signature clips, celebrations, idle habits and the chalk showcase (spec §4.11,
 * §4.12, C6, C8, [ANIM §9.3 L1–L6, §8.2–§8.4]).
 *
 * Exports
 *   LEBRON_CLIPS  normalised ClipDefs (shared registrations; times final, tempo false):
 *     sig.lebron.chasedown, sig.lebron.tomahawk, sig.lebron.jumpStopDunk, sig.lebron.powerDrive, sig.lebron.skipPass,
 *     sig.lebron.skipOverhead, sig.lebron.leftBlockFade, sig.lebron.stepback3,
 *     cel.lebron.roar, cel.lebron.roarPound, cel.lebron.flexLite, cel.lebron.point, cel.lebron.fistPump, cel.lebron.chalk,
 *     idle.lebron.headband, idle.lebron.handsHips, idle.lebron.handsKnees, idle.lebron.shimmy
 *
 * Times reproduce select.js: chase-down takeoff 0.13 (h 0.85), apex 0.546, land 0.963; tomahawk slam 0.574, rim
 * 0.604–0.754, land 1.14; left-block fade takeoff 0.42 / set 0.55 / release 0.666 / land 0.99; step-back three takeoff
 * 0.36 / release 0.546. The skip pass whips across the body with the shoulder at its adduction limit (−15°, §1.7)
 * and the spine yaw carrying the rest of the profile's −40°. The chase-down's run-in keeps the carried entry velocity,
 * so its feet are free (no plant targets in the clip-start frame).
 */
import { defineClip } from '../clip.js';
import { SHORT, LEG, ARM, FORMS, STANCE } from '../presets.js';
import { th, jumpTail, rootAt, makeDunk, SLAM1, HAMMER1, GRIP2, defineJump } from './shots.js';

const F = FORMS.lebron;

// ---------------------------------------------------------------------------------------------------------------
// L1 chase-down block (from the penultimate step; carry ≈ 6 m/s through the air; contact at the apex)
// ---------------------------------------------------------------------------------------------------------------
const CD = { TO: 0.13, h: 0.85 };
CD.apex = CD.TO + th(CD.h); CD.land = CD.TO + 2 * th(CD.h); CD.dur = CD.land + 0.34;
const chasedown = defineJump({
  id: 'sig.lebron.chasedown', dur: CD.dur, mask: 'full', root: 'motion', entry: 'carry', entryDecel: 30, tempo: false, jump: { h: 0.85 }, hand: 'R',
  cancel: CD.land + 0.05, blendIn: 0.05, blendOut: 0.20,
  params: { cat: 'block', pin: true },
  keys: [
    [0.00, { P: [0, -0.12, 0, 5, 0, 0], S: [5, 0, 0], N: [-10, 0, 0], RA: [-20, 15, 0, 80, 10, 0, 0], LA: [40, 15, 0, 80, 10, 0, 0], RL: [10, 6, 0, 30, -10, 0],
      LL: [45, 6, 0, 80, 15, 0], Rft: [-0.10, 0, 0, 'f'], Lft: null, R: [0, 0, 0], look: 'ball', E: { jawOpen: 0.3 }, ev: 'plantR' }],
    [0.06, { Rft: null, RL: [20, 6, 0, 40, 25, 0], LL: [20, 6, 0, 25, -5, 0] }],
    // takeoff off the LEFT foot: right knee drives, left arm down and back
    [0.13, { RL: [95, 5, 0, 90, 30, 0], LL: [-10, 3, 0, 10, 40, 0], LA: [-30, 20, 0, 20, 0, 0, 0], RA: [60, 15, 0, 40, -10, 0, 0], P: [0, -0.03, 0, 0, 0, 0], ev: ['plantL', 'takeoff'] }],
    [0.18, { RL: [100, 5, 0, 90, 30, 0] }],
    // right arm swings from the hip up past the ear
    [0.30, { RA: [150, 15, 0, 20, -30, -30, 0], RC: [15, 0], S: [-10, 0, 0], N: [-20, 0, 0], RF: 'spread', E: { jawOpen: 0.5 } }],
    // apex: arm 170, elbow 10–15, wrist extended 40, fingers spread
    [CD.apex, { RA: [172, 15, 0, 12, -40, -40, 0], ev: 'apex' }],
    // arm stays high, torso turns 25° to look back at the court, legs reach for the landing
    [0.70, { RA: [165, 15, 0, 15, -10, 10, 0], S: [-4, 25, 0], RL: [20, 8, 0, 30, 30, 0], LL: [20, 8, 0, 30, 30, 0], RC: [0, 0] }],
    [CD.land, { P: [0, -0.15, 0, 12, 0, 0], RL: [40, 8, 0, 45, -15, 0], LL: [40, 8, 0, 45, -15, 0], RA: [110, 20, 0, 30, 0, 0, 0], LA: [30, 20, 0, 40, 0, 0, 0], S: [8, 15, 0], ev: 'land' }],
    [1.10, { RA: [60, 20, 0, 60, 10, 0, 0], RF: 'fist', S: [8, 10, 0], E: { roar: 0.6 } }],
    [CD.dur, { P: [0, -0.08, 0, 8, 0, 0], S: [6, 0, 0], N: [-5, 0, 0], RA: [30, 20, 0, 70, 10, 0, 0], LA: [20, 15, 0, 40, 10, 0, 0], RF: 'relax', E: { roar: 0.4 } }],
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// L2 transition tomahawk (right hand) and the jump-stop power dunk variant
// ---------------------------------------------------------------------------------------------------------------
const TK = { TO: 0.20, h: 0.80, slam: 0.574, hang: 0.15, land: 1.14 };
const tkRk = [[0, { R: [0, 0, 0] }], [0.20, { R: [0, 1.40 / 1.03, 0] }], [0.574, { R: [0, 2.80 / 1.03, 0] }]];
const tomahawk = defineJump({
  id: 'sig.lebron.tomahawk', dur: 1.44, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h: 0.80, hang: 0.15 }, meter: false,
  hand: 'R', cancel: 1.24, blendIn: 0.10, blendOut: 0.25, target: 'takeoff',
  params: { cat: 'dunk', hands: 1, gatherWindow: [2.41, 3.89], dTO: 1.75, toDist: 1.40 },
  keys: [
    ...tkRk,
    // pickup into the right hip pocket on a long step
    [0.00, { B: 'both', ...SHORT.HIP_R, RF: 'grip', LF: 'grip', Rft: [-0.12, 0, 0, 'f'], Lft: null, P: [0, -0.08, 0, 8, 0, 0], S: [10, 0, 0], N: [-10, 0, 0],
      RL: [15, 5, 0, 25, -5, 0], LL: [45, 5, 0, 80, 15, 0], look: 'rim', ev: ['gather', 'plantR'] }],
    [0.06, { Rft: null, RL: [30, 5, 0, 50, 20, 0] }],
    // quick plant; torso leans back 10° to convert speed
    [0.12, { Lft: [0.10, rootAt(tkRk, 0.12)[1] + 0.35, 0, 'f'], P: [0, -0.15, 0, -10, 0, 0], S: [-6, 0, 0], LL: [30, 5, 0, 45, -15, 0], RL: [50, 5, 0, 90, 20, 0], ...SHORT.HIP_R, ev: 'plantL' }],
    [0.20, { Lft: null, LL: [-10, 3, 0, 10, 40, 0], RL: [90, 5, 0, 95, 30, 0], B: 'R', LF: 'relax', P: [0, -0.03, 0, 0, 0, 0], E: { roar: 0.2 }, ev: 'takeoff' }],
    // ball cocked behind the head, left arm reaching toward the rim, arch 15–20, chin up
    [0.40, { RA: [160, 30, -50, 115, 0, -40, 0], LA: [120, 15, 0, 20, -20, 0, 0], S: [-18, 0, 0], N: [-15, 0, 0], RL: [60, 8, 0, 80, 30, 0], LL: [10, 6, 0, 30, 35, 0], E: { roar: 0.4 } }],
    // hammer: elbow extends, wrist −40 → +40, crunch
    [0.53, { RA: [175, 15, 0, 25, 40, -45, 0], S: [-4, 0, -8] }],
    [0.574, { ...SLAM1, N: [-5, 0, 0], B: 'free', E: { roar: 1.0 }, ev: 'slam' }],
    [0.64, { RA: [125, 10, 0, 5, 90, 40, 0], S: [25, 0, 0], RC: [0, 0] }],
    [TK.TO + th(TK.h), { ev: 'apex' }],
    [0.604, { RF: 'claw', RL: [60, 10, 0, 90, 20, 0], LL: [60, 10, 0, 90, 20, 0], LA: [70, 30, 0, 40, 0, 0, 0], S: [10, 0, 0], ev: 'rimGrab' }],
    [0.754, { RA: [140, 12, 0, 30, 60, 0, 0], RF: 'relax', ev: 'rimRelease' }],
    [TK.land, { RL: [40, 12, 0, 50, -15, 0], LL: [40, 12, 0, 50, -15, 0], Rft: [-0.30, 2.82, 0, 'f'], Lft: [0.30, 2.82, 0, 'f'], P: [0, -0.15, 0, 14, 0, 0], S: [10, 0, 0],
      RA: [60, 30, 0, 80, 0, 0, 0], LA: [60, 30, 0, 80, 0, 0, 0], RF: 'fist', LF: 'fist', ev: 'land' }],
    [1.44, { P: [0, -0.10, 0, 8, 0, 0], S: [-6, 0, 0], N: [-12, 0, 0], RA: [20, 40, 0, 100, -20, 0, 0], LA: [20, 40, 0, 100, -20, 0, 0], E: { roar: 1.0 } }],
  ],
});

/** Jump-stop power dunk = dunk.power2 keys with LeBron's pelvis −0.18 jump stop (his generic power2 timing). */
const jumpStopDunk = (() => {
  const d = makeDunk('lebron', 'power2');
  return defineClip({ ...d, __normalized: false, id: 'sig.lebron.jumpStopDunk' });
})();

// ---------------------------------------------------------------------------------------------------------------
// L3 power drive: shoulder bump (CONTACT 0.60), big two-hand gather, two-foot jump stop (finish = next input)
// ---------------------------------------------------------------------------------------------------------------
const pdRk = [[0, { R: [0, 0, 0] }], [0.20, { R: [0.10, 0.80, 0] }], [0.47, { R: [0.15, 2.30, 0] }], [0.80, { R: [0.15, 4.40, 0] }], [1.00, { R: [0.15, 5.20, 0] }]];
const pz = (t) => rootAt(pdRk, t)[1];
const powerDrive = defineClip({
  id: 'sig.lebron.powerDrive', dur: 1.00, mask: 'full', root: 'motion', entry: 'replace', tempo: false, hand: 'R', blendIn: 0.06, blendOut: 0.12,
  target: 'plantR', params: { cat: 'move', jumpStop: [1.2, 1.8] },
  keys: [
    ...pdRk,
    [0.00, { P: [0, -0.08, 0, 10, 0, 0], S: [15, 0, 0], N: [-10, 0, 0], B: 'drib', RA: [35, 25, 0, 60, 10, 0, 0], LA: ARM.dribRun, LF: 'grip', RL: [25, 6, 0, 40, -5, 0],
      LL: [25, 6, 0, 40, -5, 0], Rft: null, Lft: null, look: 'rim' }],
    // jab / hesitation: shoulders feint 10° the other way
    [0.10, { S: [15, -10, 0], N: [-10, 10, 0], Rft: [-0.30, pz(0.10) + 0.30, 0, 't'], RL: [30, 6, 0, 35, -10, 0], ev: 'fake' }],
    [0.15, { Rft: null, RL: [45, 6, 0, 75, 20, 0] }],
    // first step (outside foot), long and low; torso 30–35° total with a straight spine
    [0.20, { Lft: [0.15, pz(0.20) + 0.45, 0, 't'], LL: [45, 6, 0, 55, -15, 0], P: [0, -0.15, 0, 15, 0, 0], S: [18, 0, 0], N: [-14, 0, 0], ev: 'plantL' }],
    [0.30, { Lft: null, LL: [10, 6, 0, 50, 30, 0], RL: [60, 6, 0, 70, 0, 0] }],
    [0.40, { Rft: [-0.15, pz(0.40) + 0.35, 0, 't'], RL: [40, 6, 0, 50, -12, 0], LL: [-10, 6, 0, 60, 30, 0] }],
    [0.50, { Rft: null, RL: [5, 6, 0, 60, 30, 0], LL: [60, 6, 0, 70, 0, 0], RC: [-5, 20], RA: [40, 45, 0, 90, 60, 0, 0] }],
    // shoulder bump (inside arm chicken wing, protracted clavicle): gameplay displaces the defender
    [0.60, { Lft: [0.15, pz(0.60) + 0.35, 0, 't'], LL: [40, 6, 0, 50, -12, 0], S: [16, 8, 0], P: [0, -0.16, 0, 14, 0, 0], ev: 'contact' }],
    [0.70, { Lft: null, LL: [10, 6, 0, 55, 30, 0], RL: [60, 6, 0, 75, 0, 0] }],
    // big two-hand gather into the chest on a long step
    [0.80, { Rft: [-0.12, pz(0.80) + 0.40, 0, 'f'], RL: [40, 6, 0, 55, -12, 0], B: 'both', ...SHORT.CHEST, RF: 'grip', RC: [0, 0], S: [14, 0, 0], ev: 'gather' }],
    [0.90, { Rft: null, RL: [40, 8, 0, 70, 20, 0], LL: [40, 8, 0, 70, 20, 0], P: [0, -0.10, 0, 10, 0, 0] }],
    // two-foot jump stop, ball high and protected under the chin
    [1.00, { Rft: [-0.25, pz(1.00), 0, 'f'], Lft: [0.25, pz(1.00), 0, 'f'], P: [0, -0.20, 0, 18, 0, 0], RA: ARM.chinned, LA: ARM.chinned, RL: LEG.dunkPlant, LL: LEG.dunkPlant,
      S: [16, 0, 0], N: [-14, 0, 0], E: { roar: 0.2 }, ev: ['plantL', 'plantR'] }],
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// L4 skip pass (upper, no-look one-hand whip across the body) and the overhead skip from the post
// ---------------------------------------------------------------------------------------------------------------
const skipPass = defineClip({
  id: 'sig.lebron.skipPass', dur: 0.55, mask: 'upper', layer: 'upper', root: 'none', meter: false, tempo: false, hand: 'R', blendIn: 0.06, blendOut: 0.15,
  params: { cat: 'pass', noLook: true },
  keys: [
    [0.00, { RA: ARM.dribRun, B: 'R', RF: 'grip', S: [10, 0, 0], look: 'rim' }],
    // ball pulled straight up to shoulder height, wrist cocked back
    [0.08, { RA: [95, 20, -10, 100, 90, -50, 0], S: [8, -8, 0] }],
    // whips ACROSS the body: forearm extends, wrist snaps, fingers toward the corner; torso 15–20° only
    [0.16, { RA: [85, -15, 30, 10, 100, 40, 0], S: [8, 18, 0], B: 'free', RF: 'spread', ev: 'release' }],
    [0.32, { RA: [70, -15, 35, 5, 100, 50, 0], S: [8, 20, 0] }],
    [0.55, { RA: [35, 15, 0, 50, 30, 0, 0], RF: 'relax', S: [8, 0, 0] }],
  ],
});

const skipOverhead = defineClip({
  id: 'sig.lebron.skipOverhead', dur: 0.45, mask: 'full', root: 'none', meter: false, tempo: false, hand: 'R', blendIn: 0.06, blendOut: 0.20,
  params: { cat: 'pass', noLook: true },
  keys: [
    [0.00, { RA: ARM.chinned, LA: ARM.chinned, B: 'both', RF: 'grip', LF: 'grip', S: [8, 0, 0], N: [-10, 0, 0], look: 'rim' }],
    // both arms straight overhead (flex 175, elbows 15) …
    [0.10, { RA: GRIP2.skip, LA: GRIP2.skip, S: [-6, 0, 0] }],
    // … and a two-wrist snap
    [0.18, { RA: [165, 12, 0, 10, 60, 40, 0], LA: [165, 12, 0, 10, 60, 40, 0], S: [4, 0, 0], B: 'free', RF: 'spread', LF: 'spread', ev: 'release' }],
    [0.30, { RA: [150, 12, 0, 10, 70, 50, 0], LA: [150, 12, 0, 10, 70, 50, 0] }],
    [0.45, { ...SHORT.DOWN, S: [4, 0, 0], RF: 'relax', LF: 'relax' }],
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// L5 left-block fadeaway: reverse pivot on the left foot ≈ 150° over the right shoulder, fade 0.45 + lean 15
// ---------------------------------------------------------------------------------------------------------------
const lbT = { TO: 0.42, apex: 0.42 + th(0.40), tSet: 0.55, tRel: 0.666, tLand: 0.99, tEnd: 1.30 };
const leftBlockFade = defineClip({
  id: 'sig.lebron.leftBlockFade', dur: 1.30, mask: 'full', root: 'motion', entry: 'stop', entryDecel: 18, tempo: false, jump: { h: 0.40 }, hand: 'R',
  cancel: 1.09, blendIn: 0.06, blendOut: 0.20, target: 'takeoff',
  params: { cat: 'jumper', meterFrom: 0.15, tIdeal: 0.616, METER_T: 0.58, baseSide: 'L' },
  keys: [
    [0.00, { P: [0, -0.15, 0, 10, 0, 0], S: [12, 0, 0], N: [-15, -30, 0], RA: ARM.chinned, LA: ARM.chinned, RL: LEG.postUp, LL: LEG.postUp, Rft: [-0.40, 0, 0, 'f'], Lft: [0.40, 0, 0, 't'],
      B: 'both', RF: 'grip', LF: 'grip', R: [0, 0, 0], look: 'none' }],
    [0.08, { Rft: null, RL: [30, 25, 0, 60, 10, 0], R: [0, 0, 0], P: [0, -0.16, 0, 10, -15, 0] }],
    [0.22, { R: [0.40, -0.05, -90], P: [0, -0.17, 0, 10, -10, 0], N: [-12, 0, 0] }],
    [0.30, { R: [0.64, -0.14, -150], Lft: [0.40, 0, -150, 't'], Rft: [0.88, -0.27, -150, 'f'], P: [0, -0.18, 0, 10, 0, 0], RL: [45, 6, 0, 60, -18, 0], LL: [45, 6, 0, 60, -18, 0],
      ...SHORT.CHIN, look: 'rim', ev: ['plantR', 'gather'] }],
    [0.36, { Lft: [0.40, 0, -150, 'f'], RA: [60, 12, 25, 115, 60, -40, 0], LA: [60, 20, 35, 110, -10, -20, 0] }],
    ...jumpTail('lebron', lbT, {
      lean: 18, air: { R: [30, 30], L: [10, 15] }, land: { R: [1.03, 0.15], L: [0.69, 0.35], yaw: -150 }, R: [0.86, 0.25, -150],
    }),
    // right knee kicks forward 30 in the fade
    [0.62, { RL: [30, 5, 0, 30, 30, 0], LL: [10, 5, 0, 15, 30, 0] }],
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// L6 step-back three after the left-to-right crossover: lands 0.50 m back, balanced one-motion shot, slight fade
// ---------------------------------------------------------------------------------------------------------------
const sbT = { TO: 0.36, apex: 0.36 + th(0.25), tSet: 0.416, tRel: 0.546, tLand: 0.36 + 2 * th(0.25) };
sbT.tEnd = Math.max(sbT.tLand + 0.25, sbT.tRel + 0.33 + 0.15);
const stepback3 = defineClip({
  id: 'sig.lebron.stepback3', dur: sbT.tEnd, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h: 0.25 }, hand: 'R',
  cancel: sbT.tLand + 0.10, blendIn: 0.06, blendOut: 0.20,
  params: { cat: 'jumper', meterFrom: 0, tIdeal: 0.496, METER_T: 0.62 },
  keys: [
    [0.00, { P: [0, -0.10, 0, 12, 0, 0], S: [14, 0, 0], N: [-10, 0, 0], RA: ARM.dribJog, LA: [30, 20, 0, 40, 10, 0, 0], B: 'drib', RF: 'grip', Rft: null, Lft: [0.20, -0.05, 0, 'f'],
      RL: [40, 6, 0, 55, 10, 0], LL: [30, 6, 0, 45, -10, 0], R: [0, 0, 0], look: 'rim' }],
    [0.05, { Rft: [-0.20, 0.25, 0, 'f'], RL: [35, 6, 0, 50, -15, 0], P: [0, -0.14, 0.03, 14, 0, 0], ev: 'plantR' }],
    [0.08, { R: [0, 0, 0], Lft: null, LL: [30, 6, 0, 60, 25, 0] }],
    [0.12, { B: 'both', ...SHORT.CHEST, LF: 'grip' }],
    // push back off the right foot with a small hop
    [0.14, { Rft: null, RL: [25, 6, 0, 50, 30, 0], P: [0, -0.02, 0, 6, 0, 0], S: [6, 0, 0] }],
    [0.25, { Lft: [0.20, -0.50, 10, 'f'], LL: [35, 6, 4, 50, -18, 0], R: [0, -0.50, 0], P: [0, -0.10, 0, 8, 0, 0], ev: 'plantL' }],
    [0.29, { Rft: [-0.20, -0.50, 10, 'f'], RL: [30, 6, 4, 50, -20, 0], LL: [30, 6, 4, 50, -20, 0], P: [0, -0.12, 0, 10, 0, 0], ev: 'plantR' }],
    [0.32, { P: [0, -F.dip, 0, 10, 0, 0], RA: [15, 15, 25, 85, 40, -25, 0], LA: [20, 15, 40, 95, 10, -15, 0], N: [-12, 0, 0] }],
    ...jumpTail('lebron', sbT, { lean: 6, drift: 0.60, land: { R: [-0.20, -0.60], L: [0.20, -0.63], yaw: 10 }, R: [0, -0.60, 0], followHold: 0.33 }),
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// Celebrations and the chalk showcase ([ANIM §8.2, §8.4])
// ---------------------------------------------------------------------------------------------------------------
const FLEX = [20, 40, 0, 100, -20, 0, 0];                 // fists down and out (the "Hulk" flex)
const roarKeys = (pound) => [
  [0.00, { P: [0, -0.06, 0, 6, 0, 0], S: [4, 0, 0], N: [-5, 0, 0], RA: [30, 25, 0, 60, 0, 0, 0], LA: [30, 25, 0, 60, 0, 0, 0], RL: [15, 10, 0, 20, -5, 0], LL: [15, 10, 0, 20, -5, 0],
    E: { roar: 0.1 }, look: 'crowd' }],
  // feet 1.0 apart, knees 25, chest out, chin up
  [0.12, { Rft: [-0.50, 0, -10, 'f'], Lft: [0.50, 0, 10, 'f'], RL: [20, 18, 0, 25, -5, 0], LL: [20, 18, 0, 25, -5, 0], P: [0, -0.10, 0, 4, 0, 0] }],
  [0.25, { S: [-10, 0, 0], N: [-20, 0, 0], RA: FLEX, LA: FLEX, RF: 'fist', LF: 'fist', E: { roar: 1.0 } }],
  ...(pound
    ? [[0.62, { RA: [50, -10, 60, 125, 0, 0, 0] }], [0.70, { RA: [55, -10, 60, 135, 0, 0, 0], S: [-6, 0, 0] }], [0.80, { RA: [50, -10, 60, 120, 0, 0, 0] }],
      [0.90, { RA: [55, -10, 60, 135, 0, 0, 0] }], [1.00, { RA: FLEX }]]
    : [[0.70, { RA: [22, 42, 0, 104, -20, 0, 0], LA: [22, 42, 0, 104, -20, 0, 0] }]]),
  [1.10, { E: { roar: 1.0 }, S: [-10, 0, 0] }],
  [1.30, { S: [0, 0, 0], N: [-5, 0, 0], RA: [30, 25, 0, 60, 0, 0, 0], LA: [30, 25, 0, 60, 0, 0, 0], RF: 'relax', LF: 'relax', E: { roar: 0.2 } }],
];

const cels = [
  defineClip({ id: 'cel.lebron.roar', dur: 1.30, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.30, params: { cat: 'cel' }, keys: roarKeys(false) }),
  defineClip({ id: 'cel.lebron.roarPound', dur: 1.30, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.30, params: { cat: 'cel' }, keys: roarKeys(true) }),
  defineClip({
    id: 'cel.lebron.flexLite', dur: 1.00, mask: 'upper', layer: 'upper', root: 'none', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.30, params: { cat: 'cel' },
    keys: [
      [0.00, { RA: [30, 30, 0, 80, 0, 0, 0], LA: [30, 20, 20, 60, 30, 0, 0] }],
      // biceps up (fist), the left hand slaps the right biceps at 0.45
      [0.20, { RA: [0, 90, -80, 130, -60, 0, 0], RF: 'fist', LA: [40, 20, 40, 90, 60, 0, 0], E: { roar: 0.3 } }],
      [0.40, { LA: [50, 20, 40, 95, 90, 0, 0], LF: 'flat' }],
      [0.45, { LA: [50, 15, 45, 90, 90, 10, 0] }],
      [0.60, { LA: [40, 20, 30, 80, 60, 0, 0], RA: [0, 88, -80, 128, -60, 0, 0] }],
      [1.00, { RA: [20, 30, 0, 60, 0, 0, 0], LA: [20, 20, 0, 40, 20, 0, 0], RF: 'relax', LF: 'relax', E: { roar: 0 } }],
    ],
  }),
  defineClip({
    id: 'cel.lebron.point', dur: 0.90, mask: 'upper', layer: 'upper', root: 'none', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.30, params: { cat: 'cel' },
    keys: [
      [0.00, { RA: [40, 20, 0, 60, 30, 0, 0], look: 'passer' }],
      [0.18, { RA: [95, 20, 0, 10, 60, 0, 0], RF: 'point', E: { grin: 0.4 } }],
      [0.70, { RA: [93, 20, 0, 12, 60, 0, 0] }],
      [0.90, { RA: [30, 15, 0, 40, 20, 0, 0], RF: 'relax', E: { grin: 0.2 } }],
    ],
  }),
  defineClip({
    id: 'cel.lebron.fistPump', dur: 0.50, mask: 'upper', layer: 'upper', root: 'none', tempo: false, hand: 'R', blendIn: 0.06, blendOut: 0.20, params: { cat: 'cel' },
    keys: [
      [0.00, { RA: [40, 20, 0, 70, 0, 0, 0] }],
      [0.12, { RA: [75, 20, 0, 115, 0, 0, 0], RF: 'fist', E: { roar: 0.4 } }],
      [0.25, { RA: [30, 20, 0, 120, 0, 0, 0], S: [6, 0, 0] }],
      [0.50, { RA: [20, 15, 0, 50, 20, 0, 0], RF: 'relax', S: [2, 0, 0], E: { roar: 0 } }],
    ],
  }),
  // chalk toss (intro / lineup only): two steps, palms rub ×5, turn, both arms sweep overhead, FX chalkBurst at 2.45
  defineClip({
    id: 'cel.lebron.chalk', dur: 3.20, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.20, blendOut: 0.40, params: { cat: 'cel' },
    keys: [
      [0.00, { ...standKeys(), look: 'none' }],
      [0.20, { Rft: null, RL: [30, 4, 0, 45, 15, 0], P: [0, -0.02, 0, 4, 0, 0] }],
      [0.40, { Rft: [-0.17, 0.0, -5, 'f'], RL: STANCE.stand.RL }],
      [0.55, { Lft: null, LL: [30, 4, 0, 45, 15, 0] }],
      [0.75, { Lft: [0.17, 0.0, 5, 'f'], LL: STANCE.stand.LL }],
      // palms rub: forearm oscillation ±8° at 3.3 Hz, 5 strokes
      [0.80, { RA: [40, 10, 40, 110, 0, 0, 0], LA: [40, 10, 40, 110, 0, 0, 0], RF: 'flat', LF: 'flat', N: [10, 0, 0] }],
      ...[0.95, 1.10, 1.25, 1.40, 1.55, 1.70].map((t, i) => [t, { RA: [40, 10, 40, 110, i % 2 ? -8 : 8, 0, 0], LA: [40, 10, 40, 110, i % 2 ? 8 : -8, 0, 0] }]),
      [1.80, { RA: [40, 10, 40, 110, 0, 0, 0], LA: [40, 10, 40, 110, 0, 0, 0], N: [0, 0, 0], look: 'crowd' }],
      [2.10, { RA: [30, 15, 20, 30, 0, 0, 0], LA: [30, 15, 20, 30, 0, 0, 0], S: [2, 0, 0] }],
      // both arms sweep waist → overhead, hands fling apart; head back 20, chest out
      [2.45, { RA: [170, 25, 0, 10, -20, 0, 0], LA: [170, 25, 0, 10, -20, 0, 0], RF: 'spread', LF: 'spread', N: [-20, 0, 0], S: [-10, 0, 0], E: { grin: 0.3 }, ev: [['fx', 'chalkBurst']] }],
      [2.80, { RA: [165, 35, 0, 12, -20, 0, 0], LA: [165, 35, 0, 12, -20, 0, 0] }],
      [3.20, { RA: [150, 40, 0, 15, -20, 0, 0], LA: [150, 40, 0, 15, -20, 0, 0], N: [-20, 0, 0], S: [-10, 0, 0] }],
    ],
  }),
];

function standKeys() {
  const s = STANCE.stand;
  return { P: s.P, S: s.S, N: s.N, RA: s.RA, LA: s.LA, RL: s.RL, LL: s.LL, Rft: s.Rft, Lft: s.Lft };
}

// ---------------------------------------------------------------------------------------------------------------
// Idle habits ([ANIM §8.3])
// ---------------------------------------------------------------------------------------------------------------
const HIPS = [25, 50, -40, 100, -30, -10, 0];             // hands on the hips, elbows wide
const idles = [
  defineClip({
    id: 'idle.lebron.headband', dur: 0.6, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.20, params: { cat: 'idle' },
    keys: [
      [0.00, { ...standKeys() }],
      [0.22, { RA: [130, 35, 30, 145, 0, 0, 0], LA: [130, 35, 30, 145, 0, 0, 0], RF: 'point', LF: 'point', N: [-8, 0, 0] }],
      [0.35, { RA: [135, 35, 30, 140, 0, 0, 0], LA: [135, 35, 30, 140, 0, 0, 0] }],
      [0.60, { RA: STANCE.stand.RA, LA: STANCE.stand.LA, RF: 'relax', LF: 'relax', N: [0, 0, 0] }],
    ],
  }),
  defineClip({
    id: 'idle.lebron.handsHips', dur: 2.0, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.25, blendOut: 0.30, noRhythm: true, params: { cat: 'idle' },
    keys: [
      [0.00, { ...standKeys() }],
      [0.35, { RA: HIPS, LA: HIPS, S: [-6, 0, 0], N: [-6, 0, 0], RF: 'flat', LF: 'flat' }],
      [1.20, { S: [-5, 6, 0], N: [-6, 10, 0] }],
      [1.70, { RA: HIPS, LA: HIPS, S: [-6, 0, 0], N: [-6, 0, 0] }],
      [2.00, { ...standKeys(), RF: 'relax', LF: 'relax' }],
    ],
  }),
  defineClip({
    id: 'idle.lebron.handsKnees', dur: 2.4, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.30, blendOut: 0.30, params: { cat: 'idle' },
    keys: [
      [0.00, { ...standKeys() }],
      [0.45, { P: [0, -0.10, -0.05, 18, 0, 0], S: [42, 0, 0], N: [-40, 0, 0], RA: [45, 12, 10, 10, 30, 0, 0], LA: [45, 12, 10, 10, 30, 0, 0], RL: [28, 4, 0, 35, -10, 0], LL: [28, 4, 0, 35, -10, 0] }],
      [1.00, { S: [42, 0, 4], P: [0, -0.10, -0.05, 18, 0, 3] }],
      [1.60, { S: [42, 0, -4], P: [0, -0.10, -0.05, 18, 0, -3] }],
      [2.00, { S: [42, 0, 0], P: [0, -0.10, -0.05, 18, 0, 0] }],
      [2.40, { ...standKeys() }],
    ],
  }),
  defineClip({
    id: 'idle.lebron.shimmy', dur: 0.8, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.20, noRhythm: true, params: { cat: 'idle' },
    keys: [
      [0.00, { ...standKeys(), RC: [0, 0], LC: [0, 0], E: { puff: 0 } }],
      ...[0.167, 0.333, 0.50, 0.667].map((t, i) => [t, { RC: [i % 2 ? -8 : 8, 0], LC: [i % 2 ? 8 : -8, 0], E: { puff: i < 2 ? 0.6 : 0.3 } }]),
      [0.80, { RC: [0, 0], LC: [0, 0], E: { puff: 0 } }],
    ],
  }),
];

/** LeBron's clips (shared registrations). */
export const LEBRON_CLIPS = Object.freeze([
  chasedown, tomahawk, jumpStopDunk, powerDrive, skipPass, skipOverhead, leftBlockFade, stepback3, ...cels, ...idles,
]);
