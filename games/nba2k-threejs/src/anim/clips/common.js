/**
 * clips/common.js — generic clips (dribble moves, post moves, defence, passing, catching, shared celebrations) and
 * the clip-library registration entry point (spec §4.8, §4.10, §4.11, [ANIM §4.2, §6, §7, §8.2]).
 *
 * Exports
 *   COMMON_CLIPS             shared (player-independent) normalised ClipDefs of this file
 *   commonPerPlayer(p)       per-player defs of this file (defensive jumps timed by GP hJump, steals with the
 *                            per-player SWIPE time, ankle-break fall with the per-player sit height)
 *   registerClipLibrary(playerIds = PLAYER_IDS) → { shared, perPlayer, ids }  registers every clip of the library
 *                            (this file, shots.js generators, the six signature files) with clip.js' registry;
 *                            idempotent (re-registering replaces). Call once at load before compileAll().
 *   LIBRARY_IDS              every clip id the library authors (sorted; = select.CLIP_IDS)
 *
 * Registration rules: generator output and per-player clips are registered with registerClip(def, playerId) for each
 * player whose select.js timing table contains the clip, plus one shared fallback def (the first such player in
 * PLAYER_IDS order — the same record select.js' catalog falls back to), so every (clip, player) pair has data.
 * Signature, celebration and idle clips are shared (times final, tempo false).
 *
 * Authoring: right-handed (the '_L' twin is automatic), degrees, reference metres (× sLeg); ball paths `Bp` are
 * written relative to the moving character as in the spec tables and converted with relBall() (see shots.js).
 */
import { defineClip, registerClip } from '../clip.js';
import { PLAYER_IDS, SLEG, STANCE, ARM, LEG, SHORT } from '../presets.js';
import { HJUMP, timingByClip } from '../select.js';
import { SHOT_GENERATORS, th, relBall, makeSteal, DEF_KEY, DEF_FEET as DF, GRIP2, GUIDE_SET, defineJump, RIP_LOW, RIP_HIP_L } from './shots.js';
import { KOBE_CLIPS } from './kobe.js';
import { JORDAN_CLIPS } from './jordan.js';
import { LEBRON_CLIPS } from './lebron.js';
import { GIANNIS_CLIPS } from './giannis.js';
import { YAO_CLIPS } from './yao.js';
import { KYRIE_CLIPS } from './kyrie.js';

const TT = STANCE.tripleThreat;
/** Hip-joint height per player (spec §4.1 table), for the ankle-break sit height. */
const HIP_H = Object.freeze({ kobe: 1.077, jordan: 1.074, lebron: 1.109, giannis: 1.190, yao: 1.256, kyrie: 1.013 });

// =============================================================================================================
// Dribble moves ([ANIM §4.2]; root motion, B 'path', authored right → left, mirrored)
// =============================================================================================================

const MOVES = [
  // crossover R → L (generic; Kyrie's hesiCross is the full-fidelity version)
  defineClip({
    id: 'move.cross', dur: 0.40, mask: 'full', root: 'motion', entry: 'replace', hand: 'R', cancel: 0.30, blendIn: 0.06, blendOut: 0.12,
    params: { cat: 'move', imm: [0.05, 0.30], exitV: [2.6, 3.0], freeze: 1.0, ankle: true },
    keys: relBall([
      [0.00, { P: [0, -0.06, 0, 10, 0, 0], S: [14, 0, 0], N: [-10, 0, 0], RA: [30, 14, 15, 70, 90, 10, 0], LA: [20, 12, 0, 30, 15, 0, 0],
        RL: [25, 6, 0, 45, -5, 0], LL: [10, 6, 0, 30, 10, 0], Rft: [-0.24, 0.10, 0, 't'], Lft: [0.22, -0.30, 0, 't'], B: 'path',
        Bp: [-0.15, 0.92, 0.56], R: [0, 0, 0], RF: 'grip', look: 'man' }],
      [0.05, { ev: 'plantR' }],
      [0.08, { P: [-0.06, -0.14, 0, 16, -8, 4], S: [20, -10, 6], RA: [25, 5, 35, 80, 95, 30, 0], RC: [null, 15], Bp: [-0.20, 0.55, 0.30] }],
      [0.10, { R: [-0.05, 0.10, 0] }],
      [0.13, { Bp: [0.00, 0.12, 0.36], Lft: null, LL: [45, 20, 0, 70, 15, 0], ev: 'bounce' }],
      [0.18, { P: [0.04, -0.15, 0.05, 18, 10, -6], S: [22, 12, -8], RA: [20, 10, 20, 40, 40, 0, 0], LA: [28, 15, 20, 70, 90, 10, 0], RC: [0, 0], Bp: [0.18, 0.45, 0.34] }],
      [0.20, { R: [0.35, 0.25, 0] }],
      [0.22, { Rft: null, RL: [10, 5, 0, 35, 35, 0] }],
      [0.24, { Bp: [0.29, 0.76, 0.30], B: 'drib', LA: [38, -5, 28, 40, 91, 10, 0], LF: 'grip', RF: 'relax', ev: 'handOnL' }],
      [0.28, { Lft: [1.00, 0.52, 10, 't'], RL: [40, 10, 0, 80, 10, 0], LL: [30, 8, 0, 45, -10, 0], ev: 'plantL' }],
      [0.30, { R: [0.78, 0.42, 0] }],
      [0.40, { P: [0.02, -0.09, 0, 12, 4, 0], S: [16, 4, 0], N: [-10, 0, 0], RL: [25, 6, 0, 40, -5, 0], Rft: [0.80, 0.85, 0, 't'], R: [1.00, 0.60, 0], ev: 'plantR' }],
    ]),
  }),
  // between the legs R → L (stationary or slow; feet wide, LEFT foot forward)
  defineClip({
    id: 'move.btl', dur: 0.36, mask: 'full', root: 'motion', entry: 'carry', hand: 'R', blendIn: 0.06, blendOut: 0.12,
    params: { cat: 'move', imm: [0.05, 0.28], freeze: 0.8 },
    keys: relBall([
      [0.00, { P: [0, -0.12, 0, 14, 0, 0], S: [20, 0, 0], N: [-14, 0, 0], RA: [25, 18, 10, 70, 90, 15, 0], LA: [20, 20, 0, 40, 20, 0, 0],
        RL: [10, 12, 0, 50, -15, 0], LL: [40, 12, 0, 55, -10, 0], Rft: [-0.33, -0.15, 0, 't'], Lft: [0.35, 0.25, 0, 't'], B: 'path',
        Bp: [-0.36, 0.79, 0.42], R: [0, 0, 0], RF: 'grip', look: 'man' }],
      [0.08, { RA: [15, 10, 30, 55, 95, 35, 0], Bp: [-0.12, 0.40, 0.18], P: [0, -0.14, 0, 15, 0, 0] }],
      [0.14, { Bp: [0.02, 0.12, 0.02], RA: [5, 10, 30, 45, 95, 25, 0], ev: 'bounce' }],
      [0.22, { LA: [14, -2, -10, 26, 95, 10, 0], LF: 'grip', Bp: [0.22, 0.74, 0.01], ev: 'handOnL' }],
      [0.30, { RA: [20, 15, 0, 40, 20, 0, 0], RF: 'relax' }],
      [0.36, { P: [0, -0.12, 0, 14, 0, 0], LA: [25, 18, 10, 70, 90, 15, 0], RA: [25, 15, 0, 40, 20, 0, 0], Bp: [0.32, 0.70, 0.10], B: 'drib', R: [0.15, 0.05, 0] }],
    ]),
  }),
  // behind the back R → L while moving
  defineClip({
    id: 'move.btb', dur: 0.38, mask: 'full', root: 'motion', entry: 'carry', hand: 'R', blendIn: 0.06, blendOut: 0.12,
    params: { cat: 'move', imm: [0.06, 0.30], freeze: 0.9 },
    keys: relBall([
      [0.00, { RA: [30, 14, 15, 70, 90, 10, 0], LA: [25, 20, 0, 40, 20, 0, 0], S: [12, 0, 0], P: [0, -0.08, 0, 10, 0, 0], N: [-10, 0, 0],
        B: 'path', Bp: [-0.29, 0.94, 0.52], R: [0, 0, 0], RF: 'grip', look: 'rim' }],
      [0.10, { RA: [0, 3, -55, 34, 91, 25, 0], S: [16, 0, -6], Bp: [-0.27, 0.80, -0.10] }],
      [0.17, { Bp: [0.00, 0.12, -0.30], RA: [-25, 30, -60, 50, 90, 30, 0], ev: 'bounce' }],
      [0.26, { LA: [14, 5, 0, 26, 99, 10, 0], LF: 'grip', Bp: [0.29, 0.73, 0.07], S: [14, 0, 4], ev: 'handOnL' }],
      [0.32, { RA: [20, 15, 0, 40, 20, 0, 0], RF: 'relax' }],
      [0.38, { B: 'drib', LA: [30, 14, 15, 70, 90, 10, 0], S: [12, 0, 0], Bp: [0.30, 0.75, 0.25], R: [0.35, 0, 0] }],
    ]),
  }),
  // hesitation: rise, high soft dribble, then drop and explode (carry × 0.40 over 0.05–0.22, × 1.25 from 0.26)
  defineClip({
    id: 'move.hesi', dur: 0.45, mask: 'full', root: 'motion', entry: 'carry', hand: 'R', blendIn: 0.06, blendOut: 0.12,
    params: { cat: 'move', carryScale: [[0.05, 0.22, 0.40], [0.26, 0.45, 1.25]], dribble: { yTop: 1.12 } },
    keys: [
      [0.00, { P: [0, -0.06, 0, 10, 0, 0], S: [14, 0, 0], N: [-6, 0, 0], RA: ARM.dribJog, LA: [25, 20, 0, 40, 20, 0, 0], B: 'drib', R: [0, 0, 0], look: 'man' }],
      [0.12, { P: [0, 0.00, 0, 2, 0, 0], S: [5, 0, 0], N: [-10, 0, 0], LA: [20, 30, 0, 30, 0, 0, 0], look: 'rim' }],
      [0.20, { ev: 'plantR' }],
      [0.22, { P: [0, -0.04, 0, 6, 0, 0], S: [12, 0, 0] }],
      [0.30, { P: [0, -0.10, 0, 15, 0, 0], S: [25, 0, 0], N: [-14, 0, 0], LA: [30, 20, 0, 50, 20, 0, 0], look: 'man' }],
      [0.45, { P: [0, -0.08, 0, 14, 0, 0], S: [22, 0, 0], R: [0, 0.10, 0] }],
    ],
  }),
  // reverse spin dribble (defender cutting off the right-hand drive): root yaw +360 around the left forefoot
  defineClip({
    id: 'move.spin', dur: 0.50, mask: 'full', root: 'motion', entry: 'replace', hand: 'R', blendIn: 0.06, blendOut: 0.12,
    params: { cat: 'move', imm: [0.08, 0.40], exitV: [0.6, 4.2], freeze: 1.0 },
    keys: relBall([
      [0.00, { P: [0, -0.10, 0, 14, 0, 0], S: [18, 0, 0], N: [-10, 0, 0], RA: ARM.dribJog, LA: [25, 20, 0, 40, 20, 0, 0], RL: [25, 6, 0, 45, -5, 0],
        LL: [35, 8, 0, 55, -10, 0], Lft: [0.25, 0.45, 30, 't'], Rft: [-0.25, -0.05, 0, 't'], B: 'path', Bp: [-0.29, 0.83, 0.49], R: [0, 0, 0], RF: 'grip', look: 'man' }],
      // palm on top, ball pulled to the right hip
      [0.06, { RA: [5, 20, 48, 48, 97, -10, 0], Bp: [-0.29, 0.73, 0.11], ev: 'plantL' }],
      [0.10, { N: [-5, 60, 0], R: [0, 0.15, 20] }],
      [0.20, { R: [0.15, 0.30, 140], P: [null, -0.14, null, null, 25, null], Rft: null, RL: [30, 30, 0, 70, 10, 0], LA: [30, 25, 0, 60, 20, 0, 0], RA: [-2, 19, 20, 28, 6, -4, 0], Bp: [-0.25, 0.78, 0.06] }],
      [0.30, { B: 'L', LA: [25, 18, 15, 70, 90, 10, 0], LF: 'grip', RA: [30, 25, 0, 50, 30, 0, 0], RF: 'relax', N: [-8, 20, 0], P: [null, null, null, null, 10, null], Bp: [0.25, 0.80, 0.20], ev: 'handoff' }],
      [0.34, { Rft: [0.70, 0.55, 290, 't'], RL: [30, 10, 0, 50, -10, 0], R: [0.45, 0.60, 270], ev: 'plantR' }],
      [0.38, { Lft: [0.25, 0.45, 310, 't'] }],
      [0.40, { Lft: null, LL: [40, 8, 0, 70, 20, 0] }],
      [0.42, { B: 'drib', R: [0.62, 0.90, 330], N: [-10, 0, 0], P: [null, null, null, null, 0, null] }],
      [0.50, { R: [0.75, 1.20, 360], P: [0, -0.09, 0, 12, 0, 0], S: [16, 0, 0], LL: [20, 8, 0, 40, 10, 0] }],
    ]),
  }),
  // step-back (no shot): left foot plants forward, push back 0.75 with a 0.12 hop, land L then R square
  defineClip({
    id: 'move.stepback', dur: 0.45, mask: 'full', root: 'motion', entry: 'replace', hand: 'R', blendIn: 0.06, blendOut: 0.12,
    params: { cat: 'move', imm: [0.08, 0.36], exitV: [0, 0], freeze: 0.7 },
    keys: relBall([
      [0.00, { P: [0, -0.08, 0, 12, 0, 0], S: [14, 0, 0], N: [-10, 0, 0], RA: ARM.dribJog, LA: [25, 20, 0, 40, 20, 0, 0], RL: [25, 6, 0, 40, -5, 0],
        LL: [40, 6, 0, 50, 10, 0], Rft: [-0.20, 0.0, 0, 'f'], Lft: null, B: 'path', Bp: [-0.29, 0.90, 0.51], R: [0, 0, 0], RF: 'grip', look: 'man' }],
      [0.08, { Lft: [0.18, 0.35, 5, 't'], LL: [45, 6, 0, 60, -15, 0], Rft: null, RL: [20, 6, 0, 45, 20, 0], P: [0, -0.14, 0.04, 14, 0, 0], Bp: [-0.28, 0.12, 0.35], ev: ['plantL', 'bounce'] }],
      [0.10, { R: [0, 0, 0] }],
      [0.14, { Lft: null, LL: [30, 6, 0, 45, 25, 0], P: [0, 0.02, 0, 6, 0, 0], S: [8, 0, 0], Bp: [-0.25, 0.70, 0.25] }],
      [0.20, { P: [0, 0.04, 0, 4, 0, 0], RL: [20, 6, 0, 35, 25, 0] }],
      [0.22, { B: 'both', ...SHORT.CHEST, LF: 'grip', Bp: [0, 1.05, 0.25] }],
      [0.30, { Lft: [0.20, -0.75, 0, 'f'], LL: [40, 6, 4, 55, -20, 0], P: [0, -0.12, 0, 10, 0, 0], R: [0, -0.75, 0], ev: 'plantL' }],
      [0.34, { Rft: [-0.20, -0.75, 0, 'f'], RL: [40, 6, 4, 55, -20, 0], ev: 'plantR' }],
      [0.34, { ...SHORT.CHEST }],
      [0.36, { B: 'drib' }],
      [0.45, { P: [0, -0.09, 0, 10, 0, 0], S: [12, 0, 0], N: [-8, 0, 0], RA: ARM.dribStill, LA: [25, 20, 0, 40, 20, 0, 0], LF: 'relax' }],
    ]),
  }),
];

// =============================================================================================================
// Holding / post moves ([ANIM §4.2], C13)
// =============================================================================================================

const TT_KEY = { P: TT.P, S: TT.S, N: TT.N, RA: TT.RA, LA: TT.LA, RL: TT.RL, LL: TT.LL, RF: 'grip', LF: 'grip', B: 'both' };

const HOLDING = [
  // jab step from the triple threat: right foot jabs 0.35 forward and back
  defineClip({
    id: 'move.jab', dur: 0.35, mask: 'full', root: 'none', hand: 'R', blendIn: 0.06, blendOut: 0.12, params: { cat: 'move' },
    keys: [
      [0.00, { ...TT_KEY, Rft: [-0.29, 0.04, 8, 'f'], Lft: [0.29, -0.03, 8, 'f'], look: 'man' }],
      [0.03, { Rft: null, RL: [35, 6, 0, 55, 10, 0] }],
      [0.12, { Rft: [-0.29, 0.39, 0, 't'], RL: [30, 6, 5, 40, -10, 0], P: [0, -0.155, 0.06, 16, 0, 0], S: [28, 0, 0], N: [-26, 0, 0],
        RA: [15, 33, 20, 75, 40, -25, 0], ev: ['plantR', 'fake'] }],
      [0.20, { Rft: null, RL: [30, 6, 0, 50, 10, 0] }],
      [0.30, { Rft: [-0.29, 0.04, 8, 'f'], RL: TT.RL, P: TT.P, S: TT.S, N: TT.N, RA: TT.RA }],
      [0.35, {}],
    ],
  }),
  // pump fake: ball to the set point, heels up, knees stay 30, shoulders shrug, back to the triple threat
  defineClip({
    id: 'move.pumpFake', dur: 0.40, mask: 'full', root: 'none', hand: 'R', blendIn: 0.06, blendOut: 0.12, params: { cat: 'move' },
    keys: [
      [0.00, { ...TT_KEY, Rft: [-0.29, 0.04, 8, 'f'], Lft: [0.29, -0.03, 8, 'f'], look: 'rim' }],
      [0.08, { RA: [70, 10, 25, 115, 60, -45, 0], LA: [60, 15, 40, 110, 10, -20, 0], P: [0, -0.06, 0, 8, 0, 0], S: [10, 0, 0] }],
      [0.12, { ev: 'fake' }],
      [0.18, { RA: [115, 6, 18, 95, 85, -72, 0], LA: GUIDE_SET.kobe, RF: 'shoot', P: [0, -0.04, 0, 4, 0, 0], S: [4, 0, 0],
        N: [-15, 0, 0], RL: [15, 4, 0, 30, 8, 0], LL: [15, 4, 0, 30, 8, 0], RC: [8, 0], LC: [8, 0] }],
      [0.26, { RC: [0, 0], LC: [0, 0] }],
      [0.36, { ...TT_KEY, RF: 'grip' }],
      [0.40, {}],
    ],
  }),
  // rip-through: ball sweeps low across the knees, right hip → left hip → up through the chest, elbows high
  defineClip({
    id: 'move.rip', dur: 0.30, mask: 'full', root: 'none', hand: 'R', blendIn: 0.06, blendOut: 0.12, params: { cat: 'move' },
    keys: [
      [0.00, { ...TT_KEY, ...SHORT.HIP_R, look: 'man' }],
      [0.08, { ...RIP_LOW, S: [32, -15, 0], P: [0, -0.13, 0, 14, 0, 0] }],
      [0.17, { ...RIP_HIP_L, S: [28, 10, 0] }],
      [0.30, { RA: [60, 15, 30, 120, 40, -40, 0], LA: [60, 20, 35, 115, -5, -20, 0], S: [25, 0, 0], P: [0, -0.12, 0, 12, 0, 0] }],
    ],
  }),
  // protect (upper; loops while the protect condition lasts): off arm bar, shielding shoulder toward the defender
  defineClip({
    id: 'move.protect', dur: 0.50, loop: true, mask: 'upper', layer: 'upper', hand: 'R', blendIn: 0.10, blendOut: 0.15,
    params: { cat: 'move', dribble: 'protect' },
    keys: [
      [0.00, { LA: ARM.protectBar, RA: ARM.dribProtect, S: [12, -10, 0], N: [-12, 10, 0], B: 'drib', LF: 'spread', look: 'man' }],
      [0.25, { LA: [62, 47, 40, 88, 20, 0, 0], S: [13, -11, 0] }],
      [0.50, { LA: ARM.protectBar, S: [12, -10, 0] }],
    ],
  }),
  // backdown: two 0.18 s shoves back into the defender with a CONTACT each
  defineClip({
    id: 'move.backdown', dur: 0.36, mask: 'full', root: 'motion', entry: 'replace', hand: 'R', blendIn: 0.08, blendOut: 0.15,
    params: { cat: 'move', dribble: 'backdown' },
    keys: [
      [0.00, { P: [0, -0.12, 0, 8, 0, 0], S: [10, 0, 0], N: [-15, 30, 0], RA: ARM.dribBackdown, LA: ARM.backdownBar, RL: LEG.postUp, LL: LEG.postUp,
        Rft: [-0.38, 0, 0, 'f'], Lft: [0.37, 0, 0, 'f'], B: 'drib', LF: 'spread', R: [0, 0, 0], look: 'none' }],
      [0.04, { Rft: null, RL: [30, 10, 0, 55, 5, 0] }],
      [0.14, { Rft: [-0.38, -0.15, 0, 'f'], RL: LEG.postUp, P: [0, -0.13, -0.05, 10, 0, 0] }],
      [0.18, { R: [0, -0.125, 0], P: [0, -0.12, 0, 8, 0, 0], S: [8, 0, 0], ev: 'contact' }],
      [0.22, { Lft: null, LL: [30, 10, 0, 55, 5, 0] }],
      [0.32, { Lft: [0.37, -0.25, 0, 'f'], LL: LEG.postUp, P: [0, -0.13, -0.05, 10, 0, 0] }],
      [0.36, { R: [0, -0.25, 0], P: [0, -0.12, 0, 8, 0, 0], S: [8, 0, 0], ev: 'contact' }],
    ],
  }),
  // gather (upper): ball to both hands at the chest
  defineClip({
    id: 'move.gather', dur: 0.10, mask: 'upper', layer: 'upper', hand: 'R', blendIn: 0.04, blendOut: 0.10, params: { cat: 'move' },
    keys: [
      [0.00, { RA: ARM.dribStill, LA: [30, 20, 20, 60, 20, -10, 0], LF: 'relax' }],
      [0.10, { ...SHORT.CHEST, B: 'both', RF: 'grip', LF: 'grip', ev: 'pickup' }],
    ],
  }),
  // face-up from the post (C13, new): hop-turn 180° in place into the triple threat
  defineClip({
    id: 'post.faceUp', dur: 0.35, mask: 'full', root: 'motion', entry: 'replace', hand: 'R', blendIn: 0.06, blendOut: 0.15,
    params: { cat: 'move' },
    keys: [
      [0.00, { P: STANCE.postUp.P, S: STANCE.postUp.S, N: [-15, 30, 0], RA: ARM.chinned, LA: ARM.chinned, RL: LEG.postUp, LL: LEG.postUp,
        Rft: [-0.38, 0, 0, 'f'], Lft: [0.37, 0, 0, 't'], B: 'both', RF: 'grip', LF: 'grip', R: [0, 0, 0], look: 'none' }],
      [0.05, { Rft: null, RL: [35, 10, 0, 60, 10, 0], N: [-15, 60, 0], P: [0, -0.14, 0, 10, 20, 0] }],
      [0.12, { Lft: null, LL: [30, 8, 0, 50, 15, 0], R: [0, 0, 60] }],
      [0.25, { Lft: [-0.29, -0.03, 188, 'f'], LL: TT.LL, R: [0, 0, 170], P: [0, -0.12, 0, 12, 0, 0], N: [-20, 0, 0], ...SHORT.HIP_R, look: 'man' }],
      [0.30, { Rft: [0.29, 0.04, 188, 'f'], RL: TT.RL, ev: 'plantR' }],
      [0.35, { ...TT_KEY, R: [0, 0, 180] }],
    ],
  }),
];

// =============================================================================================================
// Defence ([ANIM §6], spec §4.10, C4, C5, C8, C22)
// =============================================================================================================

/**
 * Defensive jumps timed with GP hJump (C8): def.contest1, def.vertical, def.block1, reb.jump2 for player p. The
 * load is keyed 0.04 s before the takeoff and the legs extend at the takeoff (the tables put the load pose at the
 * takeoff key; the extension makes the jump read). Times = select.js defJumpSpec.
 */
function defJumps(p) {
  const h = HJUMP[p], half = th(h);
  const mk = (id, cat, TO, tail, keysFn, extra = {}) => {
    const apex = TO + half, land = TO + 2 * half, dur = land + tail;
    return defineJump({
      id, dur, mask: 'full', root: 'none', entry: 'stop', entryDecel: extra.decel || 30, tempo: false, jump: { h }, hand: 'R',
      cancel: land + 0.05, blendIn: 0.05, blendOut: 0.20, params: { cat },
      keys: keysFn({ TO, apex, land, dur }).concat([[apex, { ev: 'apex' }]]),
    });
  };
  const contest = mk('def.contest1', 'contest', 0.08, 0.20, (A) => [
    [0, { ...DEF_KEY, P: [0, -0.04, 0, 8, 0, 0], RA: [60, 30, 0, 30, 30, 0, 0], RL: [20, 8, 0, 30, -8, 0], LL: [20, 8, 0, 30, -8, 0], look: 'ball' }],
    [0.04, { P: [0, -0.10, 0, 10, 0, 0], RL: [35, 10, 0, 45, -15, 0], LL: [35, 10, 0, 45, -15, 0], RA: [100, 20, 0, 30, -10, 0, 0], LA: [50, 35, 0, 40, 20, 0, 0] }],
    [A.TO, { P: [0, -0.03, 0, 4, 0, 0], RL: LEG.takeoff, LL: LEG.takeoff, RA: [145, 12, 0, 15, -25, 0, 0], RF: 'spread', ev: 'takeoff' }],
    [A.apex, { RA: ARM.contestApex, LA: ARM.contestOther, RL: LEG.contestAir, LL: LEG.contestAir, S: [-4, 0, 0] }],
    [A.land, { RL: LEG.contestLand, LL: LEG.contestLand, P: [0, -0.12, 0, 10, 0, 0], RA: [120, 15, 0, 30, -20, 0, 0], S: [6, 0, 0], ev: 'land' }],
    [A.dur, { P: [0, -0.12, 0, 12, 0, 0], RA: [70, 25, 0, 30, 20, 0, 0], LA: [55, 35, 0, 35, 20, 0, 0], RF: 'relax', S: [12, 0, 0] }],
  ]);
  const vertical = mk('def.vertical', 'contest', 0.10, 0.40, (A) => [
    [0, { ...DEF_KEY, P: [0, -0.06, 0, 6, 0, 0], RA: [80, 40, 0, 40, -20, 0, 0], LA: [80, 40, 0, 40, -20, 0, 0], RL: [25, 8, 0, 35, -10, 0], LL: [25, 8, 0, 35, -10, 0], look: 'ball' }],
    [0.06, { P: [0, -0.12, 0, 6, 0, 0], RL: [35, 8, 0, 45, -15, 0], LL: [35, 8, 0, 45, -15, 0], RA: [140, 15, 0, 20, -60, 0, 0], LA: [140, 15, 0, 20, -60, 0, 0] }],
    [A.TO, { P: [0, -0.02, 0, 0, 0, 0], S: [0, 0, 0], RL: LEG.takeoff, LL: LEG.takeoff, RA: ARM.vertical, LA: ARM.vertical, RF: 'spread', LF: 'spread', ev: 'takeoff' }],
    [A.apex, { RL: LEG.verticalAir, LL: LEG.verticalAir }],
    [A.land, { RL: LEG.contestLand, LL: LEG.contestLand, P: [0, -0.10, 0, 6, 0, 0], ev: 'land' }],
    [A.land + 0.20, { RA: [100, 60, 0, 30, -30, 0, 0], LA: [100, 60, 0, 30, -30, 0, 0] }],
    [A.dur, { RA: [70, 80, 0, 30, -20, 0, 0], LA: [70, 80, 0, 30, -20, 0, 0], RF: 'relax', LF: 'relax', P: [0, -0.10, 0, 8, 0, 0], S: [8, 0, 0] }],
  ]);
  const block = mk('def.block1', 'block', p === 'yao' ? 0.13 : 0.08, 0.25, (A) => [
    [0, { ...DEF_KEY, P: [0, -0.12, 0, 12, 0, 0], RL: LEG.blockLoad, LL: LEG.blockLoad, RA: ARM.blockLoad, LA: ARM.blockLoad, look: 'ball' }],
    [A.TO, { P: [0, -0.03, 0, 4, 0, 0], RL: LEG.takeoff, LL: LEG.takeoff, RA: [110, 15, 0, 20, -10, 0, 0], LA: [60, 25, 0, 30, 0, 0, 0], RF: 'spread', ev: 'takeoff' }],
    [A.apex, { RA: ARM.blockApex, LA: ARM.blockOther, RL: LEG.blockAir, LL: LEG.blockAir, S: [8, -10, 0] }],
    [A.land, { RL: LEG.contestLand, LL: LEG.contestLand, P: [0, -0.12, 0, 10, 0, 0], RA: [120, 15, 0, 30, -20, 0, 0], LA: [80, 30, 0, 30, 0, 0, 0], S: [6, 0, 0], ev: 'land' }],
    [A.dur, { P: [0, -0.12, 0, 12, 0, 0], RA: [70, 25, 0, 30, 20, 0, 0], LA: [55, 35, 0, 35, 20, 0, 0], RF: 'relax', S: [12, 0, 0] }],
  ]);
  const reb = mk('reb.jump2', 'rebound', p === 'yao' ? 0.10 : 0.12, 0.45, (A) => [
    [0, { P: [0, -0.04, 0, 8, 0, 0], S: [8, 0, 0], N: [-25, 0, 0], RA: [30, 25, 0, 30, 0, 0, 0], LA: [30, 25, 0, 30, 0, 0, 0], RL: [20, 8, 0, 30, -8, 0], LL: [20, 8, 0, 30, -8, 0], look: 'ball' }],
    [A.TO - 0.04, { P: [0, -0.15, 0, 14, 0, 0], RL: LEG.reboundLoad, LL: LEG.reboundLoad, RA: ARM.reboundLoad, LA: ARM.reboundLoad }],
    [A.TO, { P: [0, -0.03, 0, 4, 0, 0], RL: LEG.takeoff, LL: LEG.takeoff, RA: [120, 15, 0, 20, -40, 0, 0], LA: [120, 15, 0, 20, -40, 0, 0], RF: 'spread', LF: 'spread', ev: 'takeoff' }],
    [A.apex, { RA: ARM.reboundApex, LA: ARM.reboundApex, RL: LEG.reboundAir, LL: LEG.reboundAir, S: [0, 0, 0], N: [-30, 0, 0] }],
    [A.land, { P: [0, -0.12, 0, 10, 0, 0], RL: LEG.reboundLand, LL: LEG.reboundLand, RA: ARM.chinItYao, LA: ARM.chinItYao, RF: 'grip', LF: 'grip', S: [10, 0, 0], N: [-10, 0, 0], ev: 'land' }],
    [A.land + 0.15, { S: [10, 10, 0] }],
    [A.land + 0.30, { S: [10, -10, 0] }],
    [A.dur, { S: [10, 0, 0], P: [0, -0.10, 0, 8, 0, 0] }],
  ], { decel: 20 });
  return [contest, vertical, block, reb];
}

const DEFENCE = [
  // closeout: upper body + pelvis drop; the chop steps are the gait's (params.gait), root decelerates at 10 m/s²
  defineClip({
    id: 'def.closeout', dur: 0.60, mask: 'upper', root: 'motion', entry: 'stop', entryDecel: 10, hand: 'R', blendIn: 0.06, blendOut: 0.15,
    params: { cat: 'defence', gait: { cadence: 5.0, step: 0.25, pelvisDrop: 0.10, trunk: 10, toe: true }, exitDist: 1.2 },
    keys: [
      [0.00, { S: [12, 0, 0], N: [-15, 0, 0], LA: [90, 30, 0, 40, -10, 0, 0], RA: [45, 35, 0, 40, 30, 0, 0], R: [0, 0, 0], look: 'man' }],
      [0.10, { LA: ARM.closeoutHand, LF: 'spread', RA: ARM.closeoutOther, S: [10, 0, 0] }],
      [0.35, { LA: [152, 20, 0, 18, -40, 0, 0] }],
      [0.60, { LA: ARM.closeoutHand, R: [0, 0, 0] }],
    ],
  }),
  // hands up (upper, C22): contest arm and the other arm up in 0.10 s, held through the man's windup
  defineClip({
    id: 'def.handUp', dur: 1.00, mask: 'upper', layer: 'upper', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.20,
    params: { cat: 'contest' },
    keys: [
      [0.00, { RA: [70, 30, 0, 30, 20, 0, 0], LA: [60, 35, 0, 30, 20, 0, 0], look: 'ball' }],
      [0.10, { RA: ARM.handUp, LA: ARM.handUpOther, RF: 'spread', LF: 'spread' }],
      [0.55, { RA: [165, 12, 0, 12, -30, 3, 0], LA: [118, 30, 0, 32, 0, 0, 0] }],
      [1.00, { RA: ARM.handUp, LA: ARM.handUpOther }],
    ],
  }),
  // failed steal (C5: played at rate 0.35/stun): overreach, arm continues up, feet locked
  defineClip({
    id: 'def.stealMiss', dur: 0.35, mask: 'full', root: 'none', tempo: false, hand: 'R', blendIn: 0.06, blendOut: 0.15,
    params: { cat: 'stun' },
    keys: [
      [0.00, { P: [0, -0.16, 0.08, 18, -10, 0], S: [18, -20, 0], N: [-20, 0, 0], RA: ARM.stealEnd, LA: [60, 45, 0, 40, 0, 0, 0],
        RL: [45, 10, 0, 55, -15, 0], LL: [40, 14, 0, 60, -12, 0], look: 'ball' }],
      [0.15, { S: [25, -22, 0], P: [0, -0.18, 0.10, 20, -12, 0], RA: ARM.stealMiss, N: [-15, 10, 0] }],
      [0.35, { S: [22, -18, 0], RA: [85, 20, 10, 15, 60, 30, 0], P: [0, -0.17, 0.08, 18, -10, 0] }],
    ],
  }),
  // box-out stance (loops; contact pushes are gameplay)
  defineClip({
    id: 'def.boxout', dur: 1.00, loop: true, mask: 'full', root: 'none', hand: 'R', blendIn: 0.10, blendOut: 0.20, params: { cat: 'defence' },
    keys: [
      [0.00, { P: STANCE.boxOut.P, S: STANCE.boxOut.S, N: STANCE.boxOut.N, RA: STANCE.boxOut.RA, LA: STANCE.boxOut.LA, RL: LEG.boxOut, LL: LEG.boxOut,
        Rft: STANCE.boxOut.Rft, Lft: STANCE.boxOut.Lft, RF: 'spread', LF: 'spread', look: 'ball' }],
      [0.50, { RA: [22, 88, -30, 92, -40, 0, 0], LA: [22, 88, -30, 92, -40, 0, 0], P: [0, -0.165, -0.06, 20, 0, 0] }],
      [1.00, { RA: STANCE.boxOut.RA, LA: STANCE.boxOut.LA, P: STANCE.boxOut.P }],
    ],
  }),
  // crossed: weight goes the wrong way (authored for a fake to the defender's left, f = +1; '_L' for the right)
  defineClip({
    id: 'def.stumble', dur: 0.40, mask: 'full', root: 'motion', entry: 'replace', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.15,
    params: { cat: 'stun' },
    keys: [
      [0.00, { P: [0.15, -0.12, 0, 12, 0, 15], S: [10, 0, 12], N: [-20, 0, 0], RA: ARM.flail, LA: ARM.flail, RL: [35, 10, 0, 50, -10, 0], LL: [35, 25, 0, 50, -10, 0],
        Rft: DF.Rft, Lft: DF.Lft, R: [0, 0, 0], look: 'ball' }],
      [0.03, { Lft: null, LL: [30, 30, 0, 45, 5, 0] }],
      [0.20, { Lft: [0.625, -0.03, 15, 't'], LL: [40, 20, 0, 55, -10, 0], P: [0.16, -0.14, 0, 12, 0, 12] }],
      [0.18, { Rft: null, RL: [30, 10, 0, 50, 10, 0] }],
      [0.25, { N: [-20, -30, 0], R: [0.20, 0, 0] }],
      [0.38, { Rft: [-0.175, 0.03, -10, 't'], RL: DEF_KEY.RL }],
      [0.40, { ...DEF_KEY, R: [0.20, 0, 0] }],
    ],
  }),
  // bumped (additive 0.30 s): pelvis 0.12 away from the contact, trunk roll 10°, arms out 30°
  defineClip({
    id: 'def.bumped', dur: 0.30, mask: 'full', layer: 'add', root: 'none', noRhythm: true, hand: 'R', blendIn: 0.02, blendOut: 0.10,
    params: { cat: 'stun' },
    keys: [
      [0.00, { P: [0, 0, 0, 0, 0, 0], S: [0, 0, 0], RA: [0, 0, 0, 0, 0, 0, 0], LA: [0, 0, 0, 0, 0, 0, 0] }],
      [0.08, { P: [0.12, 0, 0, 0, 0, -6], S: [0, 0, 10], RA: [0, 30, 0, 0, 0, 0, 0], LA: [0, 30, 0, 0, 0, 0, 0] }],
      [0.30, { P: [0, 0, 0, 0, 0, 0], S: [0, 0, 0], RA: [0, 0, 0, 0, 0, 0, 0], LA: [0, 0, 0, 0, 0, 0, 0] }],
    ],
  }),
  // loose ball scoop: bend to the floor, catch at 0.20, rise
  defineClip({
    id: 'loose.scoop', dur: 0.30, mask: 'full', root: 'none', hand: 'R', blendIn: 0.06, blendOut: 0.15, params: { cat: 'catch' },
    keys: [
      [0.00, { P: [0, -0.08, 0, 15, 0, 0], S: [25, 0, 0], N: [-20, 0, 0], RA: [40, 15, 10, 30, -20, 0, 0], LA: [40, 15, 10, 30, -20, 0, 0], RL: [30, 8, 0, 40, -8, 0],
        LL: [30, 8, 0, 40, -8, 0], look: 'ball' }],
      [0.15, { P: [0, -0.22, 0, 25, 0, 0], S: [60, 0, 0], N: [-35, 0, 0], RA: GRIP2.scoop, LA: GRIP2.scoop,
        RL: [50, 10, 0, 70, -20, 0], LL: [50, 10, 0, 70, -20, 0], RF: 'spread', LF: 'spread' }],
      [0.20, { B: 'both', RF: 'grip', LF: 'grip', ev: 'catch' }],
      [0.30, { P: [0, -0.14, 0, 18, 0, 0], S: [35, 0, 0], N: [-25, 0, 0], ...SHORT.CHEST, RL: [40, 8, 0, 55, -15, 0], LL: [40, 8, 0, 55, -15, 0] }],
    ],
  }),
];

/**
 * def.ankleFall for player p: the pelvis sits 0.16 m above the floor, i.e. P dy =
 * −(hipH − 0.16)/sLeg. Sitting geometry: the pelvis tilts back 25° (posterior), hips 95°, knees 80° put the heels on
 * the floor ≈ 0.60 m in front of the hips with the hands posted behind (the spec's knees-up [85,·,·,105] pose would
 * place the feet under the floor at that pelvis height; the foot targets keep the spec's ±0.20 spacing).
 */
function ankleFallDef(p) {
  const hipH = HIP_H[p], sLeg = SLEG[p];
  const dy = -(hipH - 0.16) / sLeg;
  return defineClip({
    id: 'def.ankleFall', dur: 1.60, mask: 'full', root: 'motion', entry: 'replace', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.25,
    params: { cat: 'stun' },
    keys: [
      [0.00, { P: [0.25, -0.14, 0, 12, 0, 18], S: [10, 0, 15], N: [-20, 0, 0], RA: ARM.flail, LA: ARM.flail, LL: [35, 15, 30, 55, -10, 0],
        RL: [-10, -10, -20, 30, 10, 0], Lft: DF.Lft, Rft: null, R: [0, 0, 0], look: 'ball' }],
      [0.20, { P: [0.30, -0.28, -0.05, 5, 0, 15], S: [0, 0, 15], Lft: null, LL: [30, 20, 30, 60, 10, 0], RA: [70, 70, 0, 30, 0, 0, 0], LA: [50, 60, 0, 30, 0, 0, 0] }],
      [0.35, { P: [0.30, dy * 0.7, -0.12, -15, 0, 6], RL: [70, 15, 0, 70, 0, 0], LL: [70, 15, 0, 70, 0, 0], RA: [-20, 25, 0, 15, -60, -50, 0], LA: [-20, 25, 0, 15, -60, -50, 0], S: [10, 0, 5] }],
      [0.50, { P: [0.30, dy, -0.15, -25, 0, 0], S: [15, 0, 0], N: [-10, 0, 0], RL: [95, 15, 0, 80, 0, 0], LL: [95, 15, 0, 80, 0, 0],
        Rft: [0.10, 0.45, 0, 'f'], Lft: [0.50, 0.45, 0, 'f'], RA: ARM.postBehind, LA: ARM.postBehind, RF: 'flat', LF: 'flat', E: { jawOpen: 0.4 },
        R: [0.30, 0, 0], ev: [['fx', 'ooh']] }],
      [1.30, { P: [0.30, dy, -0.15, -25, 0, 0], S: [15, 0, 0], RL: [95, 15, 0, 80, 0, 0], LL: [95, 15, 0, 80, 0, 0], E: { jawOpen: 0.2 } }],
      [1.38, { Rft: null, P: [0.25, dy * 0.75, 0, 10, 0, -10], RL: [90, 10, 0, 120, 0, 0], RA: [40, 30, 0, 30, -60, -60, 0], LA: [40, 30, 0, 30, -60, -60, 0], S: [25, 0, 0] }],
      [1.48, { Lft: null, P: [0.28, -0.35, 0, 20, 0, 0], S: [25, 0, 0], RL: [60, 10, 0, 90, 0, 0], LL: [60, 10, 0, 90, -10, 0], RA: [40, 30, 0, 40, 20, 0, 0], LA: [40, 30, 0, 40, 20, 0, 0], RF: 'relax', LF: 'relax' }],
      [1.60, { ...DEF_KEY, R: [0.30, 0, 0], E: { jawOpen: 0 } }],
    ],
  });
}

// =============================================================================================================
// Passing ([ANIM §7.2]; C6 — selectPass warps RELEASE to the GP release time)
// =============================================================================================================

const PASSES = [
  defineClip({
    id: 'pass.chest', dur: 0.45, mask: 'full', root: 'none', meter: false, hand: 'R', blendIn: 0.06, blendOut: 0.20, params: { cat: 'pass' },
    keys: [
      [0.00, { ...SHORT.CHEST, B: 'both', RF: 'grip', LF: 'grip', S: [6, 0, 0], Lft: null, LL: [25, 6, 0, 35, 5, 0], look: 'receiver' }],
      [0.05, { RA: ARM.passWind, LA: ARM.passWind, S: [-4, 0, 0] }],
      [0.10, { RA: ARM.passChestRel, LA: ARM.passChestRel, S: [8, 0, 0], B: 'free', RF: 'spread', LF: 'spread', Lft: [0.20, 0.25, 0, 'f'], LL: [20, 6, 0, 25, -10, 0], ev: 'release' }],
      [0.22, { RA: ARM.passChestFollow, LA: ARM.passChestFollow }],
      [0.45, { ...SHORT.DOWN, S: [4, 0, 0], RF: 'relax', LF: 'relax' }],
    ],
  }),
  defineClip({
    id: 'pass.bounce', dur: 0.45, mask: 'full', root: 'none', meter: false, hand: 'R', blendIn: 0.06, blendOut: 0.20, params: { cat: 'pass' },
    keys: [
      [0.00, { ...SHORT.CHEST, B: 'both', RF: 'grip', LF: 'grip', S: [8, 0, 0], Lft: null, LL: [25, 6, 0, 35, 5, 0], look: 'receiver' }],
      [0.06, { RA: ARM.passWind, LA: ARM.passWind, S: [4, 0, 0] }],
      [0.12, { RA: [45, 10, 10, 15, 80, 40, 0], LA: [45, 10, 10, 15, 80, 40, 0], S: [18, 0, 0], B: 'free', RF: 'spread', LF: 'spread', Lft: [0.20, 0.25, 0, 'f'], LL: [25, 6, 0, 35, -10, 0], ev: 'release' }],
      [0.24, { RA: [45, 10, 5, 5, 95, 50, 0], LA: [45, 10, 5, 5, 95, 50, 0] }],
      [0.45, { ...SHORT.DOWN, S: [6, 0, 0], RF: 'relax', LF: 'relax' }],
    ],
  }),
  defineClip({
    id: 'pass.lob', dur: 0.40, mask: 'full', root: 'none', meter: false, hand: 'R', blendIn: 0.06, blendOut: 0.20, params: { cat: 'pass' },
    keys: [
      [0.00, { ...SHORT.CHEST, B: 'both', RF: 'grip', LF: 'grip', S: [6, 0, 0], look: 'receiver' }],
      [0.08, { RA: ARM.passLobDip, LA: ARM.passLobDip, S: [10, 0, 0], P: [0, -0.05, 0, 6, 0, 0] }],
      [0.16, { RA: ARM.passLobRel, LA: ARM.passLobRel, S: [-4, 0, 0], P: [0, -0.01, 0, 2, 0, 0], B: 'free', RF: 'spread', LF: 'spread', ev: 'release' }],
      [0.26, { RA: [130, 12, 10, 15, 50, 25, 0], LA: [130, 12, 10, 15, 50, 25, 0] }],
      [0.40, { ...SHORT.DOWN, S: [4, 0, 0], P: [0, -0.02, 0, 3, 0, 0], RF: 'relax', LF: 'relax' }],
    ],
  }),
  defineClip({
    id: 'pass.overhead', dur: 0.45, mask: 'full', root: 'none', meter: false, hand: 'R', blendIn: 0.06, blendOut: 0.20, params: { cat: 'pass' },
    keys: [
      [0.00, { RA: [120, -5, 21, 90, 30, -20, 0], LA: [120, -5, 21, 90, 30, -20, 0], B: 'both', RF: 'grip', LF: 'grip', S: [0, 0, 0], look: 'receiver' }],
      [0.08, { RA: GRIP2.passLoad, LA: GRIP2.passLoad, S: [-6, 0, 0] }],
      [0.18, { RA: ARM.passOverheadRel, LA: ARM.passOverheadRel, S: [8, 0, 0], B: 'free', RF: 'spread', LF: 'spread', ev: 'release' }],
      [0.28, { RA: [110, 10, 0, 0, 95, 45, 0], LA: [110, 10, 0, 0, 95, 45, 0] }],
      [0.45, { ...SHORT.DOWN, S: [4, 0, 0], RF: 'relax', LF: 'relax' }],
    ],
  }),
  defineClip({
    id: 'pass.push1', dur: 0.30, mask: 'upper', layer: 'upper', root: 'none', meter: false, hand: 'R', blendIn: 0.06, blendOut: 0.15, params: { cat: 'pass' },
    keys: [
      [0.00, { RA: ARM.dribJog, B: 'R', RF: 'grip', look: 'receiver' }],
      [0.04, { RA: ARM.push1Load, S: [8, 6, 0] }],
      [0.08, { RA: ARM.push1Rel, B: 'free', RF: 'spread', S: [10, -4, 0], ev: 'release' }],
      [0.16, { RA: [80, 10, 0, 5, 95, 50, 0] }],
      [0.30, { RA: [40, 15, 0, 40, 30, 0, 0], RF: 'relax', S: [10, 0, 0] }],
    ],
  }),
];

// =============================================================================================================
// Catching ([ANIM §7.4]): CATCH at 0 (the gameplay catch), absorb 0.15 s, READY 0.30 s after CATCH
// =============================================================================================================

const catchClip = (id, start, layer, legs) => defineClip({
  id, dur: 0.45, mask: layer === 'upper' ? 'upper' : 'full', layer, root: 'none', tempo: false, hand: 'R', blendIn: 0.06, blendOut: 0.15,
  params: { cat: 'catch' },
  keys: [
    [0.00, { RA: start, LA: start, B: 'both', RF: 'grip', LF: 'grip', look: 'ball', ...(legs ? legs[0] : {}), ev: 'catch' }],
    [0.15, { RA: [35, 15, 30, 80, 20, -30, 0], LA: [35, 15, 30, 80, 20, -30, 0], ...(legs ? legs[1] : {}) }],
    [0.30, { ev: 'ready' }],
    [0.45, { RA: TT.RA, LA: TT.LA, look: 'man', ...(legs ? legs[2] : {}) }],
  ],
});

const CATCHES = [
  defineClip({
    id: 'catch.ready', dur: 0.30, loop: true, mask: 'upper', layer: 'upper', root: 'none', hand: 'R', blendIn: 0.12, blendOut: 0.10,
    params: { cat: 'catch' },
    keys: [
      [0.00, { RA: ARM.catchReady, LA: ARM.catchReady, RF: 'spread', LF: 'spread', look: 'ball' }],
      [0.15, { RA: [62, 20, 0, 48, -60, -3, 0], LA: [62, 20, 0, 48, -60, -3, 0] }],
      [0.30, { RA: ARM.catchReady, LA: ARM.catchReady }],
    ],
  }),
  catchClip('catch.chest', GRIP2.catchChest, 'upper', null),
  catchClip('catch.high', GRIP2.catchHigh, 'upper', null),
  catchClip('catch.low', GRIP2.catchLow, 'action', [
    { P: [0, -0.12, 0, 15, 0, 0], S: [25, 0, 0], RL: [40, 8, 0, 60, -20, 0], LL: [40, 8, 0, 60, -20, 0] },
    { P: [0, -0.10, 0, 14, 0, 0], S: [20, 0, 0], RL: [35, 8, 0, 55, -18, 0], LL: [35, 8, 0, 55, -18, 0] },
    { P: TT.P, S: TT.S, RL: TT.RL, LL: TT.LL },
  ]),
  catchClip('catch.run', [55, 0, 20, 37, -40, 0, 0], 'upper', null),
];

// =============================================================================================================
// Shared celebrations ([ANIM §8.2])
// =============================================================================================================

const CELS = [
  // high five to the scorer (Yao bends and lowers his hand)
  defineClip({
    id: 'cel.highFive', dur: 0.80, mask: 'upper', layer: 'upper', root: 'none', hand: 'R', blendIn: 0.10, blendOut: 0.30, params: { cat: 'cel' },
    per: { yao: { keys: [[0.40, { RA: [100, 60, 0, 15, -60, 0, 0], S: [25, 0, 0] }], [0.55, { RA: [95, 55, 0, 20, -60, 0, 0], S: [22, 0, 0] }]] } },
    keys: [
      [0.00, { RA: [40, 20, 0, 40, 0, 0, 0], S: [8, 0, 0], E: { grin: 0.3 }, look: 'passer' }],
      [0.25, { RA: [130, 20, 0, 25, -50, 0, 0], RF: 'spread' }],
      [0.40, { RA: [150, 20, 0, 15, -60, 0, 0], RF: 'flat', E: { grin: 0.5 } }],
      [0.55, { RA: [140, 20, 0, 20, -60, 10, 0] }],
      [0.80, { RA: [20, 15, 0, 30, 20, 0, 0], RF: 'relax', S: [5, 0, 0], E: { grin: 0.2 } }],
    ],
  }),
  // stare back after a chase-down (LeBron / Giannis): upper fist clench + roar
  defineClip({
    id: 'cel.block.stare', dur: 0.80, mask: 'upper', layer: 'upper', root: 'none', tempo: false, hand: 'R', blendIn: 0.10, blendOut: 0.30,
    params: { cat: 'cel' },
    keys: [
      [0.00, { RA: [50, 25, 0, 60, 0, 0, 0], LA: [40, 25, 0, 50, 0, 0, 0], N: [-5, 0, 0], E: { roar: 0.2 }, look: 'ball' }],
      [0.15, { RA: [60, 30, 0, 110, 0, 0, 0], LA: [50, 30, 0, 110, 0, 0, 0], RF: 'fist', LF: 'fist', S: [-6, 0, 0], N: [-12, 0, 0], E: { roar: 0.8 } }],
      [0.60, { RA: [55, 30, 0, 115, 0, 0, 0], LA: [45, 30, 0, 112, 0, 0, 0], E: { roar: 0.8 } }],
      [0.80, { RA: [30, 20, 0, 50, 10, 0, 0], LA: [30, 20, 0, 50, 10, 0, 0], RF: 'relax', LF: 'relax', S: [4, 0, 0], N: [0, 0, 0], E: { roar: 0.2 } }],
    ],
  }),
];

/** Shared (player-independent) clips of this file. */
export const COMMON_CLIPS = Object.freeze([...MOVES, ...HOLDING, ...DEFENCE, ...PASSES, ...CATCHES, ...CELS]);

/** Per-player clips of this file: defensive jumps (hJump), steals (SWIPE time), the ankle-break sit height. */
export function commonPerPlayer(p) {
  return [...defJumps(p), makeSteal(p), ankleFallDef(p)];
}

// =============================================================================================================
// Registration
// =============================================================================================================

const SIGNATURE = [...KOBE_CLIPS, ...JORDAN_CLIPS, ...LEBRON_CLIPS, ...GIANNIS_CLIPS, ...YAO_CLIPS, ...KYRIE_CLIPS];

/** Every clip id authored by the library (sorted). */
export const LIBRARY_IDS = Object.freeze([...new Set([
  ...COMMON_CLIPS.map((d) => d.id), ...commonPerPlayer('kobe').map((d) => d.id),
  ...Object.keys(SHOT_GENERATORS), ...SIGNATURE.map((d) => d.id),
])].sort());

/**
 * Registers the whole library with clip.js' registry (spec §4.2 compile phase: call before compileAll()). Generator
 * clips: one def per player whose select.js timing table has the clip (registerClip(def, p)) + a shared fallback
 * (the first such player in PLAYER_IDS order, as select.js' catalog); per-player common clips likewise with the
 * first player as fallback; everything else shared. Returns { shared, perPlayer, ids }.
 */
export function registerClipLibrary(playerIds = PLAYER_IDS) {
  const it = registerClipLibrarySteps(playerIds);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

/**
 * The same registration as a generator that yields after every registered def, so a loader can spread it over
 * time slices (main.js: no long task during the loading screen). Its return value is registerClipLibrary's result.
 */
export function* registerClipLibrarySteps(playerIds = PLAYER_IDS) {
  let shared = 0, perPlayer = 0;
  for (const d of COMMON_CLIPS) { registerClip(d); shared++; yield shared + perPlayer; }
  for (const d of SIGNATURE) { registerClip(d); shared++; yield shared + perPlayer; }
  for (const id of Object.keys(SHOT_GENERATORS)) {
    const gen = SHOT_GENERATORS[id];
    const owners = PLAYER_IDS.filter((p) => timingByClip(p, id));
    const fallback = owners.length ? owners[0] : PLAYER_IDS[0];
    registerClip(gen(fallback)); shared++;
    yield shared + perPlayer;
    for (const p of playerIds) if (owners.includes(p)) { registerClip(gen(p), p); perPlayer++; yield shared + perPlayer; }
  }
  const fb = commonPerPlayer(PLAYER_IDS[0]);
  for (const d of fb) { registerClip(d); shared++; }
  yield shared + perPlayer;
  for (const p of playerIds) { for (const d of commonPerPlayer(p)) { registerClip(d, p); perPlayer++; } yield shared + perPlayer; }
  return { shared, perPlayer, ids: LIBRARY_IDS };
}
