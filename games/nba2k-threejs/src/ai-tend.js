/**
 * @module ai-tend
 * Per-legend tendency helpers and the geometry / estimate layer of the v2 AI (spec §2.5, §5.10, GP §10.2–§10.5).
 * Every tendency comes from the legend records (`LEGENDS[id].tend`, `.spots`, `.traits`, `.ratings`) and the shared
 * spot table `SLOTS_V2`: nothing is copied here, so the tendencies cannot drift from `legends.js` (§1.2).
 *
 * Exports
 *   tendOf(p) → the frozen `tend` record of a player (or legend record)
 *   zoneTend(p, zone) → shot-mix multiplier for a rating zone: rim/layup/dunk → shotRim, close → shotClose,
 *     mid → shotMid, three → shotThree
 *   threeGateOK(p, openness, shotClock) → false when the legend's three gate forbids a three now (Giannis needs
 *     openness ≥ 2.5 m; Yao never unless the shot clock is below 1.5 s)
 *   isoMovesRoll(p, rng) → dribble-move budget for one hold, uniform integer in tend.isoMoves [min, max]
 *   spotList(id) → frozen [{ slot, w }] of the legend's off-ball spots, heaviest first (SLOTS_V2 objects)
 *   topSpot(id) → the legend's heaviest spot (CHECK formation, v1 relocation fallback)
 *   onBallGap(def, man, defGap) → on-ball gap (m): defGap × (1.10 − 0.20·n(perimeterD)) + sag (beyond the arc
 *     0.6·(1 − n(three)), −0.15 when the man's three ≥ 85), Yao on the ball beyond 6.5 m from the rim ≥ 1.8 (drop)
 *   offBallSag(man) → off-ball sag fraction k toward the rim: beyond the arc lerp(0.40, 0.12, n(three)), inside 0.20
 *   closeGapOf(p) → closeout stopping distance (1.0 m; Yao 1.5 m)
 *   closeoutSpeed(p) → { mag, sprint } of a closeout (tend.closeout; sprint when ≥ 1)
 *   contestJumpTend(p, rim) → tend.contestJump[rim ? 1 : 0]
 *   helpProb(p, diff) → clamp(diff.help × tend.help, 0, 0.95) per decision tick
 *   helpRadiusOf(p) → help trigger radius (3.2 m; Giannis `helpBlock` 4.0 m)
 *   helpReactionMul(p) → help reaction factor (Giannis `helpBlock` 0.5, else 1)
 *   pokeProb(p) → probability that a CPU defender uses a poke opportunity (POKE_P × tend.stealGamble, ≤ 0.95)
 *   laneGambleP(p, diff) → 0.6 × tend.stealGamble × diff.interceptGamble (lane jump on a pass release)
 *   riskTolOf(p, diff) → tend.riskTol × diff.riskTolMul
 *   passTendOf(p) → tend.pass
 *   clutchShotMul(p, world) → 1.5 for a `clutch` owner inside the clutch window, else 1
 *   isMismatch(off, def) → H_off − H_def ≥ 0.08 or strength_off − strength_def ≥ 15
 *   postAlways(p) → true for Yao (`post` is used vs anyone)
 *   driveSideRoll(p, rng) → +1 (right-hand drive) with p tend.driveRight, else −1
 *   probeBand(p, arc) → [rMin, rMax] radial band (m from the rim) the handler probes in: the post band for a post-first
 *     mix, else the arc band (arc = true) or the midrange band
 *   arcBandRoll(p, rng) → true with p three / (mid + three) of the profile mix (one roll per hold)
 *   profileMix(id) → the frozen profile mix { rim, close, mid, three, post }
 *   dietFactor(p, world, zone) → shot-diet feedback on the rim / mid / three utilities: (profile share / observed share
 *     of the legend's attempts so far)^1.5, observed share smoothed with a prior of 6 attempts at the profile mix,
 *     clamped [0.4, 2.5] (close: only for profiles with close shots). Keeps a legend on his profile mix (§5.14 A style checks) whatever the matchup.
 *
 *
 * Geometry and estimates (the queries ai.js decides with; ai.js re-exports the public ones):
 *   distXZ, rimD, dirTo, clampCourt, segClosest, aiDiff(world, p) (behaviour column §5.11), userControls,
 *   guardOf(attacker, world), onBallDefender, nearestOpp, openness(p, world, x?, z?) (nearest contester, ≤ 6 m),
 *   guardBeaten(h, g) (R#26), laneClear(h, g, world) (§5.10), frontDefenderOf, doubled, inPaint, spotHeld,
 *   abilityCtx (eligibility facts), estMake / predictKind / epAt (EP_shoot with T̄_cpu and C_est), theta(sc),
 *   finishEst / uDrive (U_drive), postEst (U_post), passRisk / bestPassTarget (R#34 risk, U_pass), rimProtectorHome,
 *   rimKind, POST_DIST_ZONE; constants CATCH_GATE, LEAD_V, PBEAT_BEATEN, OPEN_MAX, POST_DEPTH(_YAO), CLAMP_*.
 *
 * Zero allocation per call: the spot lists and probe bands are built once at module evaluation; the estimates use
 * module scratch objects.
 */
import { SLOTS_V2, RIM, isThree, DIFFICULTY, SHOT_V2, TRIGGERS, JAB, PASS, INTERCEPT, LINES } from './constants.js';
import { LEGENDS, LEGEND_IDS } from './legends.js';
import { n } from './ratings.js';
import { has, legendOf, clutchWindow, makeAbilityCtx, resetAbilityCtx, passRule } from './abilities.js';
import { blockChance, frontDotTo, interceptChance } from './physics.js';
import { evaluateShot, makeShotInput, resetShotInput, shotPoints } from './shot.js';
import { dunkAllowed } from './context.js';

/** Off-ball sag beyond the arc: lerp(K_FAR_LO, K_FAR_HI, n(three)) — 0.40 for a non-shooter, 0.12 for a sniper. */
const K_FAR_LO = 0.40, K_FAR_HI = 0.12, K_INSIDE = 0.20;
/** On-ball gap terms (§5.10). */
const GAP_BASE = 1.10, GAP_PERD = 0.20, SAG_K = 0.6, SNIPER_THREE = 85, SNIPER_GAP = 0.15;
const YAO_DROP_D = 6.5, YAO_DROP_GAP = 1.8, YAO_DROP_PAINT = 4.5;
const CLOSE_GAP = 1.0, CLOSE_GAP_YAO = 1.5;
const HELP_MAX = 0.95, HELP_R = 3.2, HELP_R_GIANNIS = 4.0, HELP_REACTION_GIANNIS = 0.5;
/**
 * Base probability that a CPU on-ball defender spends a poke opportunity (dribbler inside his steal range, attempt
 * interval elapsed). The spec fixes the attempt interval (cpuStealInterval) and the per-legend gamble factor; the base
 * is the balance knob of the steals band (§5.14 A: 4–10 % of possessions).
 */
const POKE_P = 0.50, POKE_MAX = 0.95;
const LANE_GAMBLE_K = 0.6;
/**
 * Calibration of the §5.10 risk sum against the game's own interception / deflection physics (I3 forced-pass trials,
 * 3,000 CPU passes over 8 auto games): risk 0–0.2 → 0 % lost, 0.2–0.5 → 2–9 %, 0.5–0.8 → 21 %, > 0.8 → 67–84 %. The
 * legend riskTol values (§2.5, 0.10–0.18) read as "acceptable risk units" would forbid nearly every pass (84 % of
 * handler ticks had no receiver), so they are compared on this scale: tol = riskTol × riskTolMul × 3.0 (band A: CPU passes
 * lost 3–5 %).
 */
export const RISK_TOL_SCALE = 3.0;
const MISMATCH_H = 0.08, MISMATCH_STR = 15;
const CLUTCH_SHOT_MUL = 1.5;
const DIET_PRIOR = 6, DIET_K = 1.5, DIET_MIN = 0.4, DIET_MAX = 2.5;
/** Probe bands (m from the rim): perimeter-heavy mixes probe at the arc, midrange-heavy mixes inside it. */
const BAND_ARC = Object.freeze([6.4, 7.9]), BAND_MID = Object.freeze([4.8, 6.9]), BAND_POST = Object.freeze([3.6, 5.6]);
/** Giannis attacks downhill from deep (euro step 5.4–7.6 m, long gather 6.4–7.8 m at speed): his arc band starts deeper. */
const BAND_DEEP = Object.freeze([7.2, 8.4]);

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function idOf(p) {
  const L = legendOf(p);
  return L ? L.id : null;
}

const SPOTS = {};
const TOP = {};
const POST_FIRST = {};
for (const id of LEGEND_IDS) {
  const sp = LEGENDS[id].spots;
  const list = Object.keys(sp).filter((k) => SLOTS_V2[k]).sort((a, b) => sp[b] - sp[a]).map((k) => Object.freeze({ slot: SLOTS_V2[k], w: sp[k] }));
  SPOTS[id] = Object.freeze(list);
  TOP[id] = list.length ? list[0].slot : SLOTS_V2.top;
  POST_FIRST[id] = LEGENDS[id].tend.mix.post >= 0.5;
}
const NO_SPOTS = Object.freeze([]);

/** The `tend` record of a player / legend. */
export function tendOf(p) {
  const L = legendOf(p);
  return L ? L.tend : null;
}

/** Shot-mix multiplier of a rating zone (§2.5: m = 0.6 + 1.6·share; rim shots use shotRim). */
export function zoneTend(p, zone) {
  const T = tendOf(p);
  if (!T) return 1;
  switch (zone) {
    case 'three': return T.shotThree;
    case 'mid': return T.shotMid;
    case 'close': return T.shotClose;
    default: return T.shotRim;
  }
}

/** Three gate (§5.10): Giannis needs openness ≥ traits.threeGate (2.5 m); Yao (gate ∞) only under 1.5 s of shot clock. */
export function threeGateOK(p, openness, shotClock) {
  const L = legendOf(p);
  const g = L ? L.traits.threeGate : null;
  if (g === null || g === undefined) return true;
  if (!Number.isFinite(g)) return shotClock < 1.5;
  return openness >= g;
}

/** Dribble-move budget of one hold: an integer uniform in tend.isoMoves [min, max]. */
export function isoMovesRoll(p, rng) {
  const T = tendOf(p);
  if (!T) return 0;
  const lo = T.isoMoves[0], hi = T.isoMoves[1];
  return lo + Math.min(hi - lo, Math.floor(rng.next() * (hi - lo + 1)));
}

/** Off-ball spots of a legend, heaviest first ([{slot, w}], frozen). */
export function spotList(id) {
  return SPOTS[id] || NO_SPOTS;
}

/** The heaviest spot of a legend (a SLOTS_V2 object). */
export function topSpot(id) {
  return TOP[id] || SLOTS_V2.top;
}

/** Radial probe band [rMin, rMax] (m from the rim): post-first legends the post band, else arc / midrange. */
export function probeBand(p, arc) {
  const id = idOf(p);
  if (POST_FIRST[id]) return BAND_POST;
  if (arc && has(p, 'giannis.longDunk')) return BAND_DEEP;
  return arc ? BAND_ARC : BAND_MID;
}

/** Per-hold choice of the arc band: p = three / (mid + three) of the profile mix. */
export function arcBandRoll(p, rng) {
  const L = legendOf(p);
  if (!L) return false;
  const m = L.tend.mix, s = m.mid + m.three;
  return s > 0 && rng.next() < m.three / s;
}

/** Profile shot mix of a legend (frozen). */
export function profileMix(id) {
  return LEGENDS[id] ? LEGENDS[id].tend.mix : null;
}

/**
 * On-ball gap (§5.10): `defGap × (1.10 − 0.20·n(perimeterD_def)) + sag`; sag = 0.6·(1 − n(three_man)) when the man is
 * beyond the arc (Giannis +0.27, Yao +0.57), −0.15 when the man's three ≥ 85; Yao guarding the ball beyond 6.5 m from
 * the rim drops to at least 1.8 m.
 */
export function onBallGap(def, man, defGap) {
  const Ld = legendOf(def), Lm = legendOf(man);
  let gap = defGap * (GAP_BASE - GAP_PERD * n(Ld.ratings.perimeterD));
  if (isThree(man.pos.x, man.pos.z)) gap += SAG_K * (1 - n(Lm.ratings.three));
  if (Lm.ratings.three >= SNIPER_THREE) gap -= SNIPER_GAP;
  if (Ld.id === 'yao') {
    const dx = man.pos.x - RIM.x, dz = man.pos.z - RIM.z;
    const dr = Math.sqrt(dx * dx + dz * dz);
    // the drop: at least 1.8 m, and no higher than the paint (YAO_DROP_PAINT from the rim; he cannot recover in space)
    if (dr > YAO_DROP_D) gap = Math.max(gap, YAO_DROP_GAP, dr - YAO_DROP_PAINT);
  }
  return gap > 0.3 ? gap : 0.3;
}

/** Off-ball sag fraction toward the rim (§5.10): beyond the arc lerp(0.40, 0.12, n(three)), inside 0.20. */
export function offBallSag(man) {
  const Lm = legendOf(man);
  return isThree(man.pos.x, man.pos.z) ? lerp(K_FAR_LO, K_FAR_HI, n(Lm.ratings.three)) : K_INSIDE;
}

/** Closeout stopping distance in front of the catch point (§5.10): 1.0 m, Yao 1.5 m. */
export function closeGapOf(p) {
  return idOf(p) === 'yao' ? CLOSE_GAP_YAO : CLOSE_GAP;
}

const CLOSE_OUT = { mag: 1, sprint: true };
/** Closeout speed (§5.10): stick magnitude min(1, tend.closeout), sprint when tend.closeout ≥ 1. Shared result. */
export function closeoutSpeed(p) {
  const T = tendOf(p);
  const c = T ? T.closeout : 1;
  CLOSE_OUT.mag = c >= 1 ? 1 : c;
  CLOSE_OUT.sprint = c >= 1;
  return CLOSE_OUT;
}

/** Contest-jump tendency (§2.5): [perimeter, rim]. */
export function contestJumpTend(p, rim) {
  const T = tendOf(p);
  return T ? T.contestJump[rim ? 1 : 0] : 1;
}

/** Help probability per decision tick (§5.10): clamp(diff.help × tend.help, 0, 0.95). */
export function helpProb(p, diff) {
  const T = tendOf(p);
  return clamp(diff.help * (T ? T.help : 1), 0, HELP_MAX);
}

/** Help trigger radius around the rim (§5.10): 3.2 m, Giannis 4.0 m. */
export function helpRadiusOf(p) {
  return has(p, 'giannis.helpBlock') ? HELP_R_GIANNIS : HELP_R;
}

/** Help reaction factor (§5.8 giannis.helpBlock: help reaction × 0.5). */
export function helpReactionMul(p) {
  return has(p, 'giannis.helpBlock') ? HELP_REACTION_GIANNIS : 1;
}

/** Probability that a CPU defender spends a poke opportunity: POKE_P × tend.stealGamble (≤ 0.95). */
export function pokeProb(p) {
  const T = tendOf(p);
  return clamp(POKE_P * (T ? T.stealGamble : 1), 0, POKE_MAX);
}

/** Lane-jump probability on a pass release (§5.10): 0.6 × tend.stealGamble × diff.interceptGamble. */
export function laneGambleP(p, diff) {
  const T = tendOf(p);
  return clamp(LANE_GAMBLE_K * (T ? T.stealGamble : 1) * diff.interceptGamble, 0, 1);
}

/** Pass risk tolerance (§2.5 riskTol × difficulty riskTolMul). */
export function riskTolOf(p, diff) {
  const T = tendOf(p);
  return (T ? T.riskTol : 0.15) * diff.riskTolMul * RISK_TOL_SCALE;
}

/** Pass tendency multiplier (§2.5 `pass`; LeBron's 1.35 is his `skipPass` AI pass value). */
export function passTendOf(p) {
  const T = tendOf(p);
  return T ? T.pass : 1;
}

/** AI shot-utility factor of the `clutch` passive (§5.8): 1.5 inside the clutch window, else 1. */
export function clutchShotMul(p, world) {
  if (!has(p, 'clutch') || !world.score) return 1;
  const diff = world.score[p.team] - world.score[1 - p.team];
  return clutchWindow(world.quarter, world.gameClock, diff) ? CLUTCH_SHOT_MUL : 1;
}

/** Post mismatch (§5.10): H_off − H_def ≥ 0.08 m or strength_off − strength_def ≥ 15. */
export function isMismatch(off, def) {
  if (!def) return false;
  const Lo = legendOf(off), Ld = legendOf(def);
  return Lo.stats.heightM - Ld.stats.heightM >= MISMATCH_H - 1e-9 || Lo.ratings.strength - Ld.ratings.strength >= MISMATCH_STR;
}

/** Yao posts against anyone (§2.5 `post`: "vs mismatch; Yao always"). */
export function postAlways(p) {
  return idOf(p) === 'yao';
}

/**
 * Shot-diet factor of a zone for a legend: compares his attempts so far (the game's metrics, `world.metrics.players`)
 * with the profile shares and returns (target / observed)^DIET_K, observed = (n_zone + PRIOR·target) / (n + PRIOR).
 */
export function dietFactor(p, world, zone) {
  const L = legendOf(p);
  if (!L) return 1;
  const z = zone === 'layup' || zone === 'dunk' || zone === 'tip' ? 'rim' : zone;
  const target = L.tend.mix[z];
  // close shots get the feedback only for the legends whose profile has them (Giannis, Yao, Kyrie; I3)
  if (!(target >= 0) || (z === 'close' && !(target > 0))) return 1;
  const M = world.metrics && world.metrics.players ? world.metrics.players[L.id] : null;
  const zs = M ? M.zone : null;
  const nz = zs ? zs[z].a : 0;
  const n = zs ? zs.rim.a + zs.close.a + zs.mid.a + zs.three.a : 0;
  const obs = (nz + DIET_PRIOR * target) / (n + DIET_PRIOR);
  if (target <= 1e-9) return DIET_MIN;
  return clamp(Math.pow(target / Math.max(obs, 1e-3), DIET_K), DIET_MIN, DIET_MAX);
}

/** Drive side for one drive: +1 (right hand) with probability tend.driveRight, else −1. */
export function driveSideRoll(p, rng) {
  const T = tendOf(p);
  return rng.next() < (T ? T.driveRight : 0.5) ? 1 : -1;
}

// ------------------------------------------------------------------------------------------------ geometry and estimates
// (§5.10) The queries ai.js decides with: distances and directions, perception helpers, EP / drive / post / pass
// estimates. Module scratch only (H10); the scratch objects here are private to this module.

/** Catch gate (R#25 / R#40): no non-urgent SHOOT within 0.40 s of a catch; receiverEP closes the defender over it. */
export const CATCH_GATE = 0.40;
/** θ(shotClock) = 0.85 + 0.35·clamp((sc − 3)/11, 0, 1) + THETA_TUNE (the spec's ±0.1 pace knob, used at +0.10). */
const THETA_LO = 0.85, THETA_SPAN = 0.35, THETA_CLOCK0 = 3, THETA_CLOCK_SPAN = 11, THETA_TUNE = 0.10;
/** Pass risk (R#34): lead-pass speed threshold, launch-point model (hand 0.30 m out, ±0.15 m wander over 1.5 m),
 * contact buffer for a defender already at the line, U_pass constants (EP × 0.92, lane penalty 0.6 inside 0.8 m). */
export const LEAD_V = 1.0;
const CONTACT_BUF = 0.05, HAND_FWD = 0.30, LAUNCH_MARGIN = 0.05, LAUNCH_SPAN = 1.5, LAUNCH_DELAY = 0.15;
/** Guard shadow: a defender within SHADOW_R of the passer whose distance to the root → catch ray is under intR + SHADOW_PAD
 * gets at least the contact odds (the launch happens 0.15–0.35 s after the press, from a hand that swings with the turn). */
const SHADOW_R = 2.2, SHADOW_PAD = 0.35;
/** Reach floor: a lane gap under this share of the defender's post-reaction run is treated as reachable. */
const REACH_FLOOR_K = 0.5;
const PASS_EP_K = 0.92, LANE_R = 0.8, LANE_PEN = 0.6, RISK_K = 0.6;
/** Drive: laneClear segment (0.90 m × next 3 m), guardBeaten lateral offset, pBeat terms (§5.10). */
const DRIVE_LANE_R = 0.90, DRIVE_LANE_LEN = 3.0, GUARD_LAT = 0.90, LANE_SHUT_MUL = 0.6;
export const PBEAT_BEATEN = 0.90;
const PBEAT_BASE = 0.20, PBEAT_RUN = 0.40, PBEAT_HANDLE = 0.20, PBEAT_STR = 0.15, PBEAT_MIN = 0.05, PBEAT_MAX = 0.60;
/** Drive finish estimate: finish point 1.2 m from the rim, trailing guard 1.0 m behind, help stops 0.8 m short,
 * contesters within 1.6 m in front (dot ≥ 0.2) may block. */
const FINISH_D = 1.2, TRAIL_D = 1.0, HELP_STOP = 0.8, BLOCK_EST_R = 1.6, BLOCK_EST_DOT = 0.2;
/** Post-up front defender radius; C_est near-defender rule (within 1.2 m: Kh + 0.15); double team radius. */
const FRONT_DEF_R = 2.0, NEAR_KH_R = 1.2, NEAR_KH_ADD = 0.15, DOUBLE_R = 1.5;
/** Openness cap and the contest front test (shot.js constants). */
export const OPEN_MAX = 6;
const FRONT_DOT = SHOT_V2.FRONT_DOT, FRONT_NEAR = SHOT_V2.FRONT_NEAR;
/** Post-shot depth (m from the rim) a post-up plays to (Yao 2.3). */
export const POST_DEPTH = 2.6, POST_DEPTH_YAO = 2.3;
/** A beaten defender trails instead of recovering when a teammate already holds the rim-side spot within 1.5 m. */
const RECOVER_HELD = 1.5;
/** Court clamp for steering targets (half court, inside the lines). */
export const CLAMP_X = 7.2, CLAMP_Z_MIN = -14.0, CLAMP_Z_MAX = -0.5;
const CMAX = SHOT_V2.CMAX;

const B = { x: 0, z: 0 }, G = { x: 0, z: 0 };
const KIND = { kind: 'jumper', variant: null };
const EST = makeShotInput();
const EST_OUT = {
  kind: null, variant: null, zone: null, d: 0, x: 0, z: 0, points: 2, pg: 0, typeMul: 1, pgTyped: 0, gS: 0, T: 1, green: false,
  airball: false, eT: NaN, C: 1, X: 0, Xraw: 0, A: 1, contact: 1, defender: null, contactDef: null, parts: { Kd: 0, Kh: 0, Ks: 0 },
  F: 1, M: 1, K: 1, diffMul: 1, fixed: false, p: 0,
};
const EP = { ep: 0, p: 0, kind: 'jumper', zone: 'mid', pts: 2 };
const PASS_OUT = { player: null, score: -Infinity, risk: 0, ep: 0, lob: false, x: 0, z: 0 };
const PASS_TMP = { risk: 0, blocked: false };
const ACTX = makeAbilityCtx();
const BLK_OPTS = { variant: null, zone: 'layup', side: 'auto', difficulty: 'normal', chasing: false, help: true, log: null, t: 0, dunk: false };
const PASS_RULE = { range: 0, speed: 0, release: 0, sigmaMul: 1, jumpPenalty: 1, id: null };
const SAVE_X = new Float64Array(8), SAVE_Z = new Float64Array(8);

export function distXZ(ax, az, bx, bz) { const dx = bx - ax, dz = bz - az; return Math.sqrt(dx * dx + dz * dz); }

export function rimD(p) { return distXZ(p.pos.x, p.pos.z, RIM.x, RIM.z); }

/** Unit vector (fx, fz) → (tx, tz) into out (−Z when degenerate). */
export function dirTo(out, fx, fz, tx, tz) {
  const dx = tx - fx, dz = tz - fz, l = Math.sqrt(dx * dx + dz * dz);
  if (l > 1e-6) { out.x = dx / l; out.z = dz / l; } else { out.x = 0; out.z = -1; }
  return out;
}

export function clampCourt(o) {
  o.x = clamp(o.x, -CLAMP_X, CLAMP_X);
  o.z = clamp(o.z, CLAMP_Z_MIN, CLAMP_Z_MAX);
  return o;
}

/** Parameter t ∈ [0, 1] of the closest point of segment a → b to (px, pz); the distance in SEG.d. */
const SEG = { t: 0, d: 0 };

export function segClosest(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az, l2 = abx * abx + abz * abz;
  const t = l2 > 1e-12 ? clamp(((px - ax) * abx + (pz - az) * abz) / l2, 0, 1) : 0;
  const cx = ax + abx * t - px, cz = az + abz * t - pz;
  SEG.t = t; SEG.d = Math.sqrt(cx * cx + cz * cz);
  return SEG;
}

/** Behaviour column of a CPU player (§5.11): CPU opponents of the human use the difficulty, everyone else `normal`. */
export function aiDiff(world, p) {
  if (world.auto || p.team === world.user) return DIFFICULTY.normal;
  const d = world.difficulty;
  return d && d.reaction !== undefined ? d : DIFFICULTY.normal;
}

/** Shooter side for the make estimate (physics.sideOf for a CPU player). */
function sideOfAI(world, p) {
  if (world.auto) return 'auto';
  return p.team !== world.user ? 'cpu' : 'mate';
}

export function userControls(world, p) {
  return typeof world.isUserControlled === 'function' ? !!world.isUserControlled(p) : (!world.auto && p === world.controlled);
}

/** The defender assigned to `attacker` (null if none). */
export function guardOf(attacker, world) {
  const ps = world.players;
  for (let i = 0; i < ps.length; i++) { const q = ps[i]; if (q.team !== attacker.team && q.defAssign === attacker) return q; }
  return null;
}

/** On-ball defender of a handler: the assigned defender, else the nearest opponent within 3 m. */
export function onBallDefender(h, world) {
  const g = guardOf(h, world);
  if (g) return g;
  const o = nearestOpp(h, world);
  return NEAR.d <= 3.0 ? o : null;
}

const NEAR = { d: Infinity };

export function nearestOpp(p, world) {
  const ps = world.players;
  let best = null, bd = Infinity;
  for (let i = 0; i < ps.length; i++) {
    const o = ps[i];
    if (o.team === p.team) continue;
    const d = distXZ(p.pos.x, p.pos.z, o.pos.x, o.pos.z);
    if (d < bd) { bd = d; best = o; }
  }
  NEAR.d = bd;
  return best;
}

/** Distance to the nearest active opponent able to contest a shot from (x, z) (in front or within 0.9 m), ≤ 6 m. */
export function openness(p, world, x, z) {
  const px = x === undefined ? p.pos.x : x, pz = z === undefined ? p.pos.z : z;
  dirTo(G, px, pz, RIM.x, RIM.z);
  const ps = world.players;
  let best = OPEN_MAX;
  for (let i = 0; i < ps.length; i++) {
    const o = ps[i];
    if (o.team === p.team || o.disabled) continue;
    const dx = o.pos.x - px, dz = o.pos.z - pz, d = Math.sqrt(dx * dx + dz * dz);
    if (d < best && (d <= FRONT_NEAR || (d > 1e-6 && (dx * G.x + dz * G.z) / d >= FRONT_DOT))) best = d;
  }
  return best;
}

/** §5.10 guardBeaten (R#26): guard null, stunned / fallen, behind the handler, or > 0.90 m off the handler→rim line. */
export function guardBeaten(h, g) {
  if (!g || g.disabled) return true;
  dirTo(G, h.pos.x, h.pos.z, RIM.x, RIM.z);
  const gx = g.pos.x - h.pos.x, gz = g.pos.z - h.pos.z;
  if (gx * G.x + gz * G.z < 0) return true;
  return Math.abs(gx * -G.z + gz * G.x) > GUARD_LAT;
}

/** §5.10 laneClear: no defender other than the guard within 0.90 m of the next 3 m of the handler→rim segment. */
export function laneClear(h, g, world) {
  const d = rimD(h), len = Math.min(DRIVE_LANE_LEN, d);
  dirTo(G, h.pos.x, h.pos.z, RIM.x, RIM.z);
  const bx = h.pos.x + G.x * len, bz = h.pos.z + G.z * len;
  const ps = world.players;
  for (let i = 0; i < ps.length; i++) {
    const o = ps[i];
    if (o.team === h.team || o === g || o.disabled) continue;
    if (segClosest(o.pos.x, o.pos.z, h.pos.x, h.pos.z, bx, bz).d < DRIVE_LANE_R) return false;
  }
  return true;
}

/** The nearest opponent within 2.0 m in front of p toward the rim (dot ≥ 0.5): who a post-up would face. */
export function frontDefenderOf(p, world) {
  const ps = world.players;
  dirTo(G, p.pos.x, p.pos.z, RIM.x, RIM.z);
  let best = null, bd = FRONT_DEF_R;
  for (let i = 0; i < ps.length; i++) {
    const o = ps[i];
    if (o.team === p.team || o.disabled) continue;
    const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z, d = Math.sqrt(dx * dx + dz * dz);
    if (d < bd && d > 1e-6 && (dx * G.x + dz * G.z) / d >= 0.5) { bd = d; best = o; }
  }
  return best;
}

/** Rating zone of a legend's post shot (hooks are close; turnaround fades from the post depth are mid beyond 3.5 m). */
export function POST_DIST_ZONE(p) { return p.id === 'yao' || (p.id === 'giannis') ? 'close' : 'mid'; }

/** Two or more defenders within 1.5 m of p. */
export function doubled(p, world) {
  const ps = world.players;
  let k = 0;
  for (let i = 0; i < ps.length; i++) {
    const o = ps[i];
    if (o.team !== p.team && distXZ(o.pos.x, o.pos.z, p.pos.x, p.pos.z) <= DOUBLE_R) k++;
  }
  return k >= 2;
}

export function inPaint(p) { return Math.abs(p.pos.x) <= LINES.KEY_HALF_W && p.pos.z <= LINES.FT_Z; }

/** Fills the shared ability context with the facts the eligibility tests read (no log, no rng). */
export function abilityCtx(p, world) {
  const c = resetAbilityCtx(ACTX);
  c.t = world.time; c.world = world; c.holding = p.holding; c.dribbling = p.dribbling; c.inPost = p.state === 'post';
  c.d = rimD(p); c.speed = p.speed; c.ftDunksUsed = p.cx.ftDunks | 0;
  c.quarter = world.quarter; c.gameClock = world.gameClock;
  if (world.score) c.scoreDiff = world.score[p.team] - world.score[1 - p.team];
  return c;
}

/**
 * Make probability estimate (§5.10 EP): evaluateShot with `estimate` (T = T̄_cpu, no green, nothing logged), then the
 * C_est correction: the best contester within 1.2 m of (x, z) is expected to jump, Kh + 0.15. `contact` false skips
 * the strength contact factor (hypothetical positions). Returns p in [0.02, cap].
 */
export function estMake(p, world, kind, variant, x, z, vx, vz, contact) {
  resetShotInput(EST);
  EST.kind = kind; EST.variant = variant; EST.x = x; EST.z = z; EST.estimate = true;
  // an easy CPU judges its shots like a normal one (T̄ 0.81, cpuMakeMul 0.96) although it shoots with the easy
  // σ / multiplier: the overconfident opponent takes the marginal looks a careful one would pass up (§5.14 B easy)
  EST.side = sideOfAI(world, p); EST.difficulty = world.difficultyId === 'easy' ? 'normal' : (world.difficultyId || 'normal');
  EST.takeoffVx = vx; EST.takeoffVz = vz;
  EST.quarter = world.quarter; EST.gameClock = world.gameClock;
  EST.scoreDiff = world.score ? world.score[p.team] - world.score[1 - p.team] : 0;
  EST.t = world.time; EST.log = null;
  EST.sinceBumpWon = world.time - p.cx.wonBumpT;
  EST.sagA = world.time <= p.cx.sagUntil ? JAB.SAG_A : 1;
  if (!contact) EST.contactDef = null;
  const r = evaluateShot(p, world, EST, EST_OUT);
  if (r.fixed) return r.p;
  let C = r.C;
  if (r.defender && r.parts.Kd > 0 && distXZ(r.defender.pos.x, r.defender.pos.z, x, z) <= NEAR_KH_R) {
    const P = r.parts;
    const x1 = P.Kd * P.Kh * P.Ks, x1b = P.Kd * Math.min(SHOT_V2.KH_MAX, P.Kh + NEAR_KH_ADD) * P.Ks;
    const X = clamp((r.Xraw + x1b - x1) * Math.max(SHOT_V2.A_FLOOR, r.A), 0, 1);
    C = (1 - CMAX[r.zone] * X) * r.contact;
  }
  return clamp(r.pgTyped * r.T * C * r.F * r.M * r.K * r.diffMul, SHOT_V2.P_MIN, kind === 'dunk' ? SHOT_V2.P_MAX_DUNK : SHOT_V2.P_MAX);
}

/** The shot kind the context resolver would give a plain SHOOT at (x, z) (§5.9.1 rows 2, 3, 10, 11, 16). */
export function predictKind(p, world, x, z, inPost) {
  const d = distXZ(x, z, RIM.x, RIM.z);
  KIND.variant = null;
  if (inPost) {
    if (p.id === 'yao') KIND.kind = 'hook';
    else { KIND.kind = 'turnFade'; KIND.variant = p.id === 'kobe' ? 'postFade' : null; }
    return KIND;
  }
  if (d <= TRIGGERS.LAYUP.STD1_MAX) {
    if (d >= TRIGGERS.DUNK.D_MIN && x === p.pos.x && z === p.pos.z && dunkAllowed(p, world, d)) { KIND.kind = 'dunk'; KIND.variant = 'power2'; }
    else { KIND.kind = 'layup'; KIND.variant = 'std'; }
    return KIND;
  }
  KIND.kind = 'jumper';
  KIND.variant = isThree(x, z) ? 'three' : 'pull12';
  if (x === p.pos.x && z === p.pos.z && world.time - p.cx.lastJabT <= JAB.PULLUP_WINDOW) KIND.variant = 'jabPullup';
  return KIND;
}

/** EP of a shot by p from (x, z) (§5.10 EP_shoot = pts × p_est); fills EP {ep, p, kind, zone, pts}. */
export function epAt(p, world, x, z, vx, vz, inPost, contact) {
  const k = predictKind(p, world, x, z, inPost);
  const pm = estMake(p, world, k.kind, k.variant, x, z, vx, vz, contact);
  EP.kind = k.kind; EP.p = pm; EP.zone = EST_OUT.zone; EP.pts = shotPoints(k.kind, x, z);
  EP.ep = EP.pts * pm;
  return EP;
}

/** θ(shotClock) = 0.85 + 0.35·clamp((shotClock − 3)/11, 0, 1) (1.20 at 14 s, 0.85 at ≤ 3 s). */
export function theta(sc) { return THETA_LO + THETA_SPAN * clamp((sc - THETA_CLOCK0) / THETA_CLOCK_SPAN, 0, 1) + THETA_TUNE; }

/** pBeat (§5.10) of a handler against his guard. */
function pBeat(h, g, world) {
  if (guardBeaten(h, g)) return PBEAT_BEATEN;
  const Lh = h.legend, Lg = g.legend;
  let v = PBEAT_BASE + PBEAT_RUN * (h.attrs.run - g.attrs.run * g.attrs.slideMul) + PBEAT_HANDLE * (Lh.ratings.ballHandle - Lg.ratings.perimeterD) / 50;
  if ((h.id === 'lebron' || h.id === 'giannis') && Lh.ratings.strength - Lg.ratings.strength >= 10) v += PBEAT_STR;
  return clamp(v, PBEAT_MIN, PBEAT_MAX);
}

/**
 * p_finish_est = P(make | the drive beats the guard): a layup (dunk for a ≥ 85 dunker) 1.2 m from the rim on the
 * handler's line, evaluated with the defenders where they will be at the finish — the beaten guard trailing (behind
 * the finish point), every other defender closing on the finish point at his run speed for the drive time after his
 * reaction, weighted by his help probability. Positions are moved for the game's own contest function, then restored.
 */
export function finishEst(h, world, g) {
  dirTo(G, RIM.x, RIM.z, h.pos.x, h.pos.z);
  const x = RIM.x + G.x * FINISH_D, z = RIM.z + G.z * FINISH_D;
  const ps = world.players;
  const sp = Math.max(h.attrs.run, h.speed);
  const tDrive = Math.max(0, distXZ(h.pos.x, h.pos.z, x, z)) / sp;
  for (let i = 0; i < ps.length; i++) {
    const o = ps[i];
    SAVE_X[i] = o.pos.x; SAVE_Z[i] = o.pos.z;
    if (o.team === h.team) continue;
    if (o === g) { o.pos.x = x + G.x * TRAIL_D; o.pos.z = z + G.z * TRAIL_D; continue; }
    const diff = aiDiff(world, o);
    const dd = distXZ(o.pos.x, o.pos.z, x, z);
    const reach = o.attrs.run * Math.max(0, tDrive - diff.reaction * helpReactionMul(o)) * helpProb(o, diff);
    const k = dd > HELP_STOP ? Math.min(reach, dd - HELP_STOP) / dd : 0;
    o.pos.x += (x - o.pos.x) * k; o.pos.z += (z - o.pos.z) * k;
  }
  // a ≥ 85 dunker dunks when the drive is a sprint (the AI sprints with sprintProb), else he lays it up
  const dunk = h.legend.ratings.dunk >= 85 && h.id !== 'kyrie';
  const kind = dunk ? 'dunk' : 'layup';
  const pLay = estMake(h, world, 'layup', 'std', x, z, 0, 0, false);
  const pDunk = dunk ? estMake(h, world, 'dunk', 'power2', x, z, 0, 0, false) : pLay;
  const sp0 = aiDiff(world, h).sprintProb;
  let pm = dunk ? sp0 * pDunk + (1 - sp0) * pLay : pLay;
  // the expected block / stuff of the best contester in front of the finish (jumping with his contest tendency)
  let pBlk = 0;
  const sx = h.pos.x, sz = h.pos.z;
  h.pos.x = x; h.pos.z = z;
  for (let i = 0; i < ps.length; i++) {
    const o = ps[i];
    if (o.team === h.team || o === g || o.disabled) continue;
    if (distXZ(o.pos.x, o.pos.z, x, z) > BLOCK_EST_R || frontDotTo(h, o, RIM.x, RIM.z) < BLOCK_EST_DOT) continue;
    BLK_OPTS.side = sideOfAI(world, o) === 'cpu' ? 'cpu' : 'auto'; BLK_OPTS.difficulty = world.difficultyId || 'normal';
    BLK_OPTS.help = true; BLK_OPTS.dunk = dunk; BLK_OPTS.zone = kind;
    const q = blockChance(h, o, kind, BLK_OPTS).pB * aiDiff(world, o).contestJumpP * contestJumpTend(o, true);
    if (q > pBlk) pBlk = q;
  }
  h.pos.x = sx; h.pos.z = sz;
  pm *= 1 - pBlk;
  for (let i = 0; i < ps.length; i++) { ps[i].pos.x = SAVE_X[i]; ps[i].pos.z = SAVE_Z[i]; }
  return pm;
}

/**
 * Players exempt from the §5.10 lane gate (U_drive = 0 when the lane is not clear): LeBron, Giannis, Yao (spec) and
 * Jordan, whose `jordan.air` mid-air switch exists to finish over the help (I3: without it the BRIGHT wings never
 * attacked a lane Giannis shades, and their drive-finished share sat at 7 % against the ≥ 15 % band).
 */
export function laneGateFree(p) {
  const id = p.id;
  return id === 'lebron' || id === 'giannis' || id === 'yao' || id === 'jordan';
}

/** U_drive (§5.10) with an optional pBeat override (U_move uses 0.90). */
export function uDrive(h, g, world, diff, pb, committed) {
  // the lane gate (§5.10) scales instead of zeroing (I3): a shut lane costs a non-exempt driver LANE_SHUT_MUL, so a
  // big payoff (a legend well below his rim share, a beaten guard) still attacks the help
  const shut = !committed && !laneGateFree(h) && !laneClear(h, g, world);
  const beat = pb > 0 ? pb : (g ? pBeat(h, g, world) : PBEAT_BEATEN);
  return 2 * finishEst(h, world, g) * beat * tendOf(h).shotRim * diff.cpuDriveMul * dietFactor(h, world, 'rim') * (shut ? LANE_SHUT_MUL : 1);
}

/**
 * Pass risk (§5.10): for each defender dl = distance to the pass segment (passer → the point where the receiver
 * catches: catch point − passReceiveR along the line), tb = s/passSpeed + passRelease, reachR = intR + run ×
 * max(0, tb − reaction), chance = dl < reachR ? 0.6·(1 − dl/reachR) : 0; risk = Σ chance. PASS_TMP.blocked = a
 * defender within LANE_R 0.8 m of the line. Returns the risk.
 */
export function passRisk(passer, recv, x, z, world) {
  const dist = distXZ(passer.pos.x, passer.pos.z, x, z);
  passRule(passer, passer.attrs, dist, false, PASS_RULE);
  // the ball leaves from the hand: where it is now (dribble / hold socket) or in front of the chest (pass clip
  // release, ≈ 0.7 m along the facing); the riskier of the two is used
  const ball = world.ball, own = ball.owner === passer;
  const fx = passer.pos.x + Math.sin(passer.yaw) * HAND_FWD, fz = passer.pos.z + Math.cos(passer.yaw) * HAND_FWD;
  const r1 = riskFrom(passer, recv, own ? ball.pos.x : fx, own ? ball.pos.z : fz, x, z, world);
  let blocked = PASS_TMP.blocked;
  const r2 = own ? riskFrom(passer, recv, fx, fz, x, z, world) : r1;
  blocked = blocked || PASS_TMP.blocked;
  // ... and from the release point after the passer turns to the receiver
  dirTo(B, passer.pos.x, passer.pos.z, x, z);
  const r3 = riskFrom(passer, recv, passer.pos.x + B.x * HAND_FWD, passer.pos.z + B.z * HAND_FWD, x, z, world);
  PASS_TMP.blocked = blocked || PASS_TMP.blocked;
  PASS_TMP.risk = Math.max(r1, r2, r3);
  return PASS_TMP.risk;
}

/** Σ chance of the defenders for the ball path (sx, sz) → (catch point − passReceiveR). */
function riskFrom(passer, recv, sx, sz, x, z, world) {
  const len = distXZ(sx, sz, x, z);
  const end = Math.max(0, len - (recv ? recv.attrs.passReceiveR : 0));
  const k = len > 1e-6 ? end / len : 0;
  const ex = sx + (x - sx) * k, ez = sz + (z - sz) * k;
  const ps = world.players;
  let risk = 0, blocked = false;
  for (let i = 0; i < ps.length; i++) {
    const d = ps[i];
    if (d.team === passer.team) continue;
    // a moving defender keeps moving through his reaction time: he is checked where he is now and where his
    // current velocity carries him by then (a guard stepping up at the press is in the lane at the release)
    const react = aiDiff(world, d).reaction, ahead = react;
    const S0 = segClosest(d.pos.x, d.pos.z, sx, sz, ex, ez);
    let sd = S0.d, st = S0.t;
    const S1 = segClosest(d.pos.x + d.vel.x * ahead, d.pos.z + d.vel.z * ahead, sx, sz, ex, ez);
    if (S1.d < sd) { sd = S1.d; st = S1.t; }
    const s = st * end;
    // the launch point wanders with the dribble / pass clip: near the hand a defender counts LAUNCH_MARGIN closer
    const dl = Math.max(0, sd - LAUNCH_MARGIN * Math.max(0, 1 - s / LAUNCH_SPAN));
    const tb = s / PASS_RULE.speed + PASS_RULE.release;
    // a stunned / fallen defender is back in play when his timer runs out: he counts if that happens before the
    // ball gets to him (a failed poke stuns the passer's guard 0.30 s, while the pass is still in the hand)
    const down = d.state === 'stunned' ? d.stunT : d.state === 'fallen' ? d.fallenT : 0;
    if (down >= tb + LAUNCH_DELAY) continue;
    const intR = d.attrs.catchR + INTERCEPT.R_ADD + (has(d, 'jordan.hawk') ? 0.20 : 0);
    const reachR = intR + d.attrs.run * Math.max(0, tb - Math.max(react, down));
    let c = dl < reachR ? RISK_K * (1 - dl / reachR) : 0;
    // a defender who only has to lean into the lane (the gap to his intercept radius is well inside what he covers
    // after his reaction) gets there whenever he gambles: lane-jump odds × the game's contact odds (I3; the spec's
    // linear term gave 0.33 to a hawk 0.14 m short of the lane, which caught 100 % of those passes)
    const gap = dl - intR, cover = d.attrs.run * Math.max(0, tb - Math.max(react, down));
    if (gap > 0 && gap < REACH_FLOOR_K * cover) {
      const pi = interceptChance(d, intR, intR);
      // the receiver's own defender always moves at the release (his closeout runs to the catch point)
      const gp = recv && d.defAssign === recv ? 1 : laneGambleP(d, aiDiff(world, d));
      const pr = gp * (pi + (1 - pi) * INTERCEPT.DEFLECT_P) * (1 - gap / (REACH_FLOOR_K * cover));
      if (pr > c) c = pr;
    }
    // a defender already inside his intercept radius of the path rolls without moving: the game's own odds
    // (interceptChance, else a 50 % deflection) are the floor of his chance
    if (dl < intR + CONTACT_BUF) {
      const pi = interceptChance(d, Math.min(dl, intR), intR);
      const pc = (pi + (1 - pi) * INTERCEPT.DEFLECT_P) * Math.min(1, (intR + CONTACT_BUF - dl) / CONTACT_BUF);
      if (pc > c) c = pc;
    }
    // the guard shadow (from the passer's root, the turn-proof launch point)
    const gx = d.pos.x - passer.pos.x, gz = d.pos.z - passer.pos.z, gd = Math.sqrt(gx * gx + gz * gz);
    if (gd < SHADOW_R) {
      const lx = x - passer.pos.x, lz = z - passer.pos.z, ll = Math.sqrt(lx * lx + lz * lz);
      if (ll > 1e-6) {
        const along = (gx * lx + gz * lz) / ll, perp = Math.abs(gx * lz - gz * lx) / ll;
        if (along > 0 && along < ll && perp < intR + SHADOW_PAD) {
          const pi = interceptChance(d, Math.min(perp, intR), intR);
          const pc = (pi + (1 - pi) * INTERCEPT.DEFLECT_P) * Math.min(1, (intR + SHADOW_PAD - perp) / SHADOW_PAD);
          if (pc > c) c = pc;
        }
      }
    }
    risk += c;
    if (dl < LANE_R) blocked = true;
  }
  PASS_TMP.blocked = blocked;
  return risk;
}

/**
 * Best pass (§5.10 U_pass): for each teammate, EP of his shot at the predicted catch point after his defender's
 * closeout × 0.92 − risk (− 0.6 with a defender within 0.8 m of the line), × tend.pass; passes with risk > riskTol
 * (× riskTolMul) are rejected; `arcOnly` keeps receivers beyond the arc (the R9 outlet). Writes PASS_OUT and returns the
 * receiver (null when none qualifies).
 */
export function bestPassTarget(h, world, out = PASS_OUT, arcOnly = false) {
  out.player = null; out.score = -Infinity; out.risk = 0; out.ep = 0; out.lob = false;
  const diff = aiDiff(world, h);
  const tol = riskTolOf(h, diff);
  const ps = world.players;
  for (let i = 0; i < ps.length; i++) {
    const q = ps[i];
    if (q === h || q.team !== h.team || q.disabled || q.isJumping || q.shot.active || q.state === 'dunk') continue;
    if (arcOnly && !isThree(q.pos.x, q.pos.z)) continue;
    const dist = distXZ(h.pos.x, h.pos.z, q.pos.x, q.pos.z);
    passRule(h, h.attrs, dist, false, PASS_RULE);
    if (dist > PASS_RULE.range || dist < 1.5) continue;
    // predicted catch point: the receiver keeps his velocity for the flight time
    const tf = Math.max(dist / PASS_RULE.speed, PASS.MIN_FLIGHT) + PASS_RULE.release;
    const cx = clamp(q.pos.x + q.vel.x * tf, -CLAMP_X, CLAMP_X), cz = clamp(q.pos.z + q.vel.z * tf, CLAMP_Z_MIN, CLAMP_Z_MAX);
    // a moving receiver: the lane to where he is now and to where he will catch must both be safe
    let risk = passRisk(h, q, cx, cz, world);
    let blocked = PASS_TMP.blocked;
    if (risk <= tol && q.speed > LEAD_V) { const r0 = passRisk(h, q, q.pos.x, q.pos.z, world); if (r0 > risk) risk = r0; blocked = blocked || PASS_TMP.blocked; }
    if (risk > tol) continue;
    const ep = receiverEP(q, world, cx, cz, tf);
    let score = (ep * PASS_EP_K - risk - (blocked ? LANE_PEN : 0)) * passTendOf(h);
    if (q.cutting) score += 0.1;
    if (score > out.score) { out.score = score; out.player = q; out.risk = risk; out.ep = ep; out.lob = false; out.x = cx; out.z = cz; }
  }
  return out.player;
}

/**
 * EP of the receiver's shot at (x, z) after his defender's closeout: the defender closes toward catch + dir(catch →
 * rim)·closeGap at sprint × closeout for the flight, the catch gate (0.40 s) minus his reaction; he is evaluated where
 * he ends up (moved there temporarily for the game's own contest function, then restored).
 */
function receiverEP(q, world, x, z, tf) {
  const g = guardOf(q, world);
  let sx = 0, sz = 0;
  if (g) {
    sx = g.pos.x; sz = g.pos.z;
    const diff = aiDiff(world, g);
    const cg = closeGapOf(g);
    dirTo(G, x, z, RIM.x, RIM.z);
    const tx = x + G.x * cg, tz = z + G.z * cg;
    const dd = distXZ(sx, sz, tx, tz);
    const cs = closeoutSpeed(g);
    const v = g.attrs.run * cs.mag * (cs.sprint ? g.attrs.sprintMul : 1);
    const cover = v * Math.max(0, tf + CATCH_GATE - diff.reaction);
    if (cover < dd) { const k = cover / dd; g.pos.x = sx + (tx - sx) * k; g.pos.z = sz + (tz - sz) * k; } else { g.pos.x = tx; g.pos.z = tz; }
  }
  const e = epAt(q, world, x, z, 0, 0, false, false).ep;
  if (g) { g.pos.x = sx; g.pos.z = sz; }
  return e;
}

/** p_est of the post shot at the expected depth with the guard on the hip (moved there for the estimate). */
export function postEst(p, world, g) {
  const depth = p.id === 'yao' ? POST_DEPTH_YAO : POST_DEPTH;
  dirTo(G, RIM.x, RIM.z, p.pos.x, p.pos.z);
  const x = RIM.x + G.x * depth, z = RIM.z + G.z * depth;
  let sx = 0, sz = 0;
  if (g) { sx = g.pos.x; sz = g.pos.z; g.pos.x = x - G.x * 0.85; g.pos.z = z - G.z * 0.85; }
  const k = predictKind(p, world, x, z, true);
  const pm = estMake(p, world, k.kind, k.variant, x, z, 0, 0, false);
  if (g) { g.pos.x = sx; g.pos.z = sz; }
  return pm;
}

export function rimProtectorHome(p, world) {
  const ps = world.players;
  for (let i = 0; i < ps.length; i++) {
    const o = ps[i];
    if (o.team === p.team || o.disabled) continue;
    if (o.legend.stats.heightM < TRIGGERS.BIG_H && !has(o, 'yao.anchor') && !has(o, 'giannis.helpBlock')) continue;
    if (distXZ(o.pos.x, o.pos.z, RIM.x, RIM.z) <= 2.0) return true;
  }
  return false;
}

/** A teammate of p already stands within RECOVER_HELD of (x, z) (the help is there: p trails instead). */
export function spotHeld(p, world, x, z) {
  const ps = world.players;
  for (let i = 0; i < ps.length; i++) {
    const q = ps[i];
    if (q !== p && q.team === p.team && distXZ(q.pos.x, q.pos.z, x, z) < RECOVER_HELD) return true;
  }
  return false;
}

/**
 * During the man's shot (R#29): steer to shooter + dir(shooter→rim)·0.70 (sprint beyond 1.0 m); the velocity
 * component away from the shooter is removed; inside 1.0 m the approach speed is capped at 2.0 m/s so the contest
 * jump's horizontal velocity stays in [0, 2.0] toward the shooter.
 */
export function rimKind(k) { return k === 'layup' || k === 'dunk' || k === 'floater' || k === 'hook'; }
