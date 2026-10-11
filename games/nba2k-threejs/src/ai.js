/**
 * @module ai
 * CPU players v2 (spec §5.10, §5.11, GP §10; v1 §7 where v2 is silent). Every CPU-driven player is steered by writing
 * ONLY into `player.intent`, the shape a human produces through input.js, so game.js resolves CPU and human actions
 * through one path (context.js). Decisions run on a 0.10 s tick staggered per player; steering and the time-critical
 * reactions (meter release, contest jumps, rebound jumps, closeouts, lane jumps) run every fixed step. Perception
 * delay is the difficulty `reaction` (positions from Player.getDelayed, the 0.5 s ring of v1).
 *
 * Exports (the AI module Game takes as `new Game({ai})`):
 *   updateAI(world, dt)             one fixed step for every CPU player (call before the intents are applied)
 *   resetAI(player)                 clears every countdown and plan (Game.start / rematch / quit, R#35)
 *   assignMatchups(world, offense)  §5.10 matchups: min Σ cost over the 6 permutations, ties by roster order
 *   planCpuRelease(player, world)   called by game.js right after a CPU SHOOT press resolved: release at
 *                                   tIdeal + eT_cpu, eT_cpu ~ N(0, cpuSigma) clamped [−0.25, +0.22] (§5.3.2)
 *   aiDebug(player)                 { action, scores: {shoot, drive, move, jab, post, pass, probe}, gates: {setup,
 *                                   catch, iso, patience} } (allocates; `__game.ai(id)`)
 *   bestPassTarget(handler, world, out?, arcOnly?) → receiver | null; `out` = {player, score, risk, ep, lob, x, z}
 *                                   (§5.10 U_pass; re-exported from ai-tend.js like the queries below)
 *   passRisk(passer, receiver, x, z, world)   Σ defender chances for a pass to (x, z) (§5.10 pass risk, R#34)
 *   handlerScores(handler, world)   the utility table of the current tick (shared object; tests)
 *   openness(p, world)              distance to the nearest opponent able to contest (front or ≤ 0.9 m), ≤ 6 m
 *   guardOf(attacker, world), guardBeaten(handler, guard, world), laneClear(handler, guard, world)
 *
 * Utilities are expected points computed with the game's own functions (evaluateShot with `estimate`, shakeChance,
 * passRule, dunkAllowed, the ability eligibility tests) — never with privileged randomness. All timers are countdowns
 * reset by resetAI (stealCd, probeFlipCd, cutCd, helpCd, contestCd, passHoldCd, releaseCd, …); there is no absolute
 * world-time stamp in the AI state. Per-world shared state (landing prediction, the pass being tracked) lives on
 * `world.aiShared`, created once per world. Zero allocation per step (H10): module scratch objects only.
 *
 * Interpretations of the spec (documented, see the WP5 report): U_jab uses a per-hold tendency roll (tend.jab is
 * "per hold"), RESET is the probe behaviour when its condition holds, the catch gate is bypassed only with the shot
 * clock ≤ 2 s (metrics count presses above 2 s as non-urgent), the pass segment of the risk ends where the receiver
 * catches (catch point − passReceiveR) and is checked from three launch points with a contact floor (the game's own
 * interceptChance for a defender already at the line), Yao's 4.5 m drop clamp applies off the ball and on the ball
 * beyond 6.5 m. Behaviour added where v2 is silent (all documented in the report): perception = delayed position +
 * delayed velocity × reaction (≤ 1.5 m) with pursuit steering; a beaten guard recovers to the rim side; rim
 * protectors shade the drive lane, help on any drive at the rim and aim their take-off at the predicted ball; a
 * started drive past its guard is committed (the lane gate only governs starting one); receivers v-cut / lift when
 * the handler's lane to them is unsafe and prefer spots the handler can reach; a shot-diet factor keeps each
 * legend near his profile mix; no AI lob passes; lane jumps start a reaction after the release.
 */
import { RIM, FIXED_DT, SHOT_V2, TRIGGERS, JAB, INTERCEPT, LINES, BLOCK, isThree } from './constants.js';
import { clamp, lerp } from './math.js';
import { predictLanding, matchupCost, PERMS, shakeChance } from './physics.js';
import { cpuReleaseError } from './shot.js';
import { has, eligible, postEntryD, headingCos, pathClear } from './abilities.js';
import { dunkAllowed } from './context.js';
import { selectDefJump } from './anim/select.js';
import { pressButton, releaseButton, clearEdges } from './input.js';
import {
  tendOf, zoneTend, threeGateOK, isoMovesRoll, spotList, topSpot, probeBand, arcBandRoll, onBallGap, offBallSag,
  closeGapOf, closeoutSpeed, contestJumpTend, helpProb, helpRadiusOf, helpReactionMul, pokeProb, laneGambleP,
  riskTolOf, clutchShotMul, isMismatch, postAlways, driveSideRoll, dietFactor, distXZ, rimD, dirTo,
  clampCourt, segClosest, aiDiff, userControls, guardOf, onBallDefender, nearestOpp, openness, guardBeaten,
  laneClear, laneGateFree, frontDefenderOf, POST_DIST_ZONE, doubled, inPaint, abilityCtx, estMake, predictKind, epAt, theta,
  finishEst, uDrive, passRisk, bestPassTarget, postEst, rimProtectorHome, rimKind, spotHeld, CATCH_GATE, LEAD_V,
  PBEAT_BEATEN, OPEN_MAX, POST_DEPTH, POST_DEPTH_YAO, CLAMP_X, CLAMP_Z_MIN, CLAMP_Z_MAX,
} from './ai-tend.js';

// public queries (tests, __game hooks, test bot) live in ai-tend.js with the other estimates
export { guardOf, openness, guardBeaten, laneClear, passRisk, bestPassTarget };

// ------------------------------------------------------------------------------------------------ constants (§5.10)
const TICK = 0.10;                          // decision tick
const HYSTERESIS = 0.40;                    // a chosen handler action persists this long (shot clock < 3 bypasses)
const NOISE = 0.05;                         // per-action utility noise rng.range(0, 0.05)
const URGENT = 3, PANIC = 1;                // shot clock: best SHOOT variant / release immediately
const URGENT_GATE = 2.0;                    // below this the catch gate is bypassed (non-urgent presses: clock > 2 s)
const URGENT_DRIVE_CLOCK = 1.8, URGENT_DRIVE_MARGIN = 0.10;   // urgent: one quick attack when it beats the heave
const SETUP_T = 0.8, PASS_GATE = 0.50;
const U_PROBE = 0.85, U_PROBE_LATE = 0.6, PROBE_LATE_CLOCK = 6, U_RESET = 0.65;
const U_JAB = 0.95, MAX_JABS = 2, JAB_R = JAB.BITE_R, JAB_REDECIDE = 0.25;
// θ(shotClock) lives in ai-tend.js (with THETA_TUNE); THETA_TUNE and PATIENCE_TUNE are the two balance knobs §5.10
// allows (θ ± 0.1, patience ± 30 %), set by test/balance.mjs band A (pace 5.5–10 s)
const PATIENCE_TUNE = 1.30;
// patience (§5.10: θ + 0.5 while tLive < tend.patience and openness < 2.5): I3 widens the openness test to 5.0 m (only
// a wide-open look skips patience) and applies the same bar to drives; with the spec's 2.5 m the possessions ran
// 4.3–5.4 s (band 5.5–10) with both knobs already at their limits
const PATIENCE_ADD = 0.5, PATIENCE_OPEN = 5.0, ISO_EXTRA = 0.6, ISO_R = 1.5;
const PASS_MARGIN = 0.10;
const SWING_T = 1.5, SWING_ADD = 0.12, SWING_EP = 0.75;   // ball movement (I3): hold time / tend.pass, bonus over probe, receiver EP floor
const MOVE_ELSE = 0.85;
const POST_MAX_D = 6.5;
// FADE_R: the spec's 1.0 m sits inside every on-ball gap (1.0–1.4 m), so no fadeaway was ever taken (I3: 1.6 m)
const FADE_R = 1.6, STEPBACK_R = 1.2, PUMP_R = 1.2, SETFEET_V = 2.5, SETFEET_CLEAR = 1.0, SETFEET_T = 0.35;
const DOUBLE_T = 0.3;
const RESET_R = 0.7, RESET_CLOCK = 8, RESET_D = 7.5, RESET_OUT_D = 8.2;
const PROBE_STEP = 1.6, PROBE_SPACE_R = 2.0, PROBE_MAG = 0.50, PROBE_MAG_ISO = 0.60;   // probing jog (≈ 2.5–3.2 m/s)
const DRIVE_STOP = 0.9, DRIVE_AROUND = 0.8, DRIVE_COMMIT = 0.25, DRIVE_COMMIT_D = 6.0, DRIVE_COMMIT_NEAR = 0.6;
const FLOATER_ROW_D = 2.15, DRIVE_DUNK_D = 3.4, DRIVE_FINISH_LO = 2.1, DRIVE_FINISH_SPAN = 1.4;
const FLOATER_LO = 2.3, FLOATER_HI = 4.4, RUNWAY_D = 10.5;
const STD2_SPEED = TRIGGERS.LAYUP.STD2_SPEED, COS45 = Math.cos(Math.PI / 4);
const POST_SPOT_X = 2.4, POST_SPOT_Z = -9.4, POST_STICK = 0.5, POST_ABANDON = 1.6;
const POST_T_MIN = 0.9, POST_T_SPAN = 1.3, POST_T_MAX = 3.5, POST_T_FIRST = 0.35;
const TEAMMATE_PASS_T = 0.4;                // the user's CPU teammate gives the ball back after this (v1 §7.2)
const SLOT_SEP = 2.5, SPOT_DIST_K = 0.15, SPOT_RISK_K = 0.5, SPOT_SWITCH = 0.10, SPOT_REFRESH = 1.0;
const RELOCATE_R = 3.0, RELOCATE_LOOKAHEAD = 1.0, RELOCATE_SPEED = 2.0;
const CUT_MIN = 4, CUT_MAX = 7, CUT_T = 1.4, CUT_DEF_R = 1.6, CUT_DEPTH = 1.2, CUT_LANE_R = 0.6, CUT_RETRY = 1.0;
const BACKDOOR_R = 1.0, BACKDOOR_P = 0.5;
const REB_RIM_R = 4.5, LOOSE_R = 5, CHASE_SPRINT_D = 3, LAND_Y = 1.8, PASS_Y = 1.3, LAND_REFRESH = 0.1;
const REB_JUMP_ADD = 0.35, REB_JUMP_TOP = 0.25;
const SHOT_HAND_FWD = 0.35;                 // the layup / dunk ball rides this far in front of the shooter's root
const RECOVER_D = 1.3;                      // a beaten on-ball defender recovers to 1.3 m in front of the rim
const GETOPEN_STEP = 1.3, GETOPEN_T = 0.9, GETOPEN_NEAR = 1.2, GETOPEN_GAIN = 0.05;   // receiver v-cut / lift
const SPOT_TAKEN_PAD = 0.15, SHOT_SIDE = 0.75, SHOT_SIDE_FWD = 0.25;   // shot steer: side spot when a blocker holds the front
// JUMP_LEAD: the jump press leads the apex by airtime/2 − JUMP_LEAD; the spec's 0.03 assumes the ball is blockable at
// the release, but with the clip's takeoff delay the apex that meets the ball passing over a defender in front comes
// later (I3 measured band-A blocks 2.7 → 4–5 % of FGA and contested FG −2 points at 0.11)
const CONTEST_R = 1.6, LATE_JUMP = 0.20, JUMP_LEAD = 0.11, CONTEST_V = 2.0, CLOSE_IN_R = 1.0, SHOT_FRONT = 0.70;
const RIM_PROTECT = { yao: TRIGGERS.YAO_ANCHOR.AI_HAND_BALL, giannis: 0.45, lebron: TRIGGERS.CHASE.AI_HAND_BALL };
const HELP_LOOK = 0.4, HELP_LOOK_PROTECTOR = 0.8, HELP_DRIVE_V = 3.0, HELP_T = 1.5, HELP_FRONT = 1.0, HELP_SPRINT_D = 2.5;
const DOUBLE_HELP_R = 3.5, DOUBLE_HELP_K = 0.5, DIG_K = 0.6;   // DIG_K: a helper's swipe = DIG_K × the on-ball poke odds
const PROTECT_D = 2.2, PROTECT_W = 0.5, OFF_TOWARD_BALL = 0.6, GAP_RIM_MARGIN = 0.3, YAO_DROP_R = 4.5, YAO_POST_R = 5.5;
const CROWD_R = 0.8, CROWD_T = 1.0, YAO_ARC_COST = 2.0, PERCEIVE_DT = 0.1, PERCEIVE_MAX = 1.5, PURSUIT_TAU = 0.25;
const STEAL_RANGE_HAWK = 0.15, POKE_CATCH = 0.5, POKE_LIVE = 0.8, POKE_MAX_V = 3.0, POKE_REACH = 0.5, POKE_COMMIT = 0.35;
const ARRIVE_R = 1.0, STOP_R = 0.06, SPRINT_MIN_D = 1.0, SPRINT_MIN_STAMINA = 0.15;
const UPUNDER_P = 0.6, PUMP_FAKE_UPUNDER = 0.6, PUMP_TAP = 0.05, PUMP_REDECIDE = 0.15, PUMP_UPUNDER_D = 3.0, UPUNDER_AFTER = 0.15;
const LOB_HOLD = 0.34, REL_MIN = 0.125;
const RIP_P = 0.5;
const TRIPLE_JAB = 0.4, TRIPLE_FADE = 0.5, TRIPLE_T = 2.2, TRIPLE_D = 7.6;   // the triple-threat jab series (Kobe, Jordan)
const MAX_YAO_BOUNCES = 2;
const YAO_KICK_CLOCK = 1.0;                // Yao beyond the arc under 3 s: kick out while ≥ 1.0 s remains

// ------------------------------------------------------------------------------------------------ scratch (H10)
const B = { x: 0, z: 0 }, G = { x: 0, z: 0 };
const PASS_OUT = { player: null, score: -Infinity, risk: 0, ep: 0, lob: false, x: 0, z: 0 };
const A = { x: 0, z: 0 }, D = { x: 0, z: 0 }, PV = { x: 0, z: 0 };
const LAND_TMP = { x: 0, z: 0, t: 0 };
const SCORES = { shoot: 0, drive: 0, move: 0, jab: 0, post: 0, pass: 0, probe: 0, reset: 0 };
const DEFJ = { intent: 'contest', chase: false, help: false, arm: 'R', hJump: 0 };
const SHAKE_OPTS = { committed: false, combo: 1, diffMul: 1 };
const ATT = [null, null, null], DEF = [null, null, null];
const TAKEN = new Uint8Array(8);

function makeShared() {
  return {
    wasLive: false, offense: -1, landX: 0, landZ: 0, landT: 0, landValid: false, landCd: 0, landState: '',
    passSeen: -1, catchX: 0, catchZ: 0, crowdT: 0, shotSeen: -1, shotTeam: -1,
  };
}

function makeAiState() {
  return {
    active: false, tick: 0, hadBall: false, action: 'probe', holdCd: 0,
    // countdowns (R#35)
    setupCd: 0, catchCd: 0, passGateCd: 0, stealCd: 0, probeFlipCd: 0, cutCd: 0, cutT: 0, helpCd: 0, contestCd: 0,
    passHoldCd: 0, pokeCd: 0, releaseCd: 0, releaseOn: false, jumpCd: 0, jumpOn: false, setFeetCd: 0, laneCd: 0, closeCd: 0,
    closeDelayCd: 0, rebCd: 0, postT: 0,
    postAbandonCd: 0, doubleT: 0, spotCd: 0, pumpCd: 0, pumpOn: false, ripWant: false,
    // plans
    holdT: 0, pressTs: 0, jumpShotT: -1, jumpShooter: null, seenPress: -1, crash: false, crashShot: -1,
    laneX: 0, laneZ: 0, closeX: 0, closeZ: 0, cutX: 0, cutZ: 0, backdoor: false, probeDir: 0, spot: null,
    isoLeft: 0, arcBand: false, jabWant: false, jabRolled: false, pumpDone: false, plan: '', driveSide: 1, driveSprint: false,
    driveEuro: false, driveFtRolled: false, finishD: 2.5, postTime: 1.5, postPlan: '', bounces: 0, forcePass: false,
    passTo: null, passLob: false, upUnder: false, laneDelayCd: 0, aimOn: false, aimX: 0, aimZ: 0, openCd: 0, openX: 0, openZ: 0,
    doubleRolled: false, wasPost: false, ballT: 0, forceThrow: false, fadeNext: false,
    scores: { shoot: 0, drive: 0, move: 0, jab: 0, post: 0, pass: 0, probe: 0 },
    gates: { setup: false, catch: false, iso: false, patience: false },
    pokes: 0,
  };
}

// ------------------------------------------------------------------------------------------------ small helpers

/** Write intent.move toward (x, z): full stick beyond 1 m, easing in, dead stop inside 6 cm; `mag` caps the stick. */
function steerTo(p, x, z, sprint, mag) {
  const it = p.intent, m = it.move;
  const dx = x - p.pos.x, dz = z - p.pos.z, d = Math.sqrt(dx * dx + dz * dz);
  if (d < STOP_R) { m.x = 0; m.z = 0; m.mag = 0; } else {
    let k = d < ARRIVE_R ? d / ARRIVE_R : 1;
    if (mag !== undefined && k > mag) k = mag;
    m.x = dx / d * k; m.z = dz / d * k; m.mag = k;
  }
  it.sprint = !!sprint && d > SPRINT_MIN_D && p.stamina > SPRINT_MIN_STAMINA;
  return d;
}

/** Stick relative to the facing: lat > 0 = the player's left (cos yaw, −sin yaw), fwd > 0 = forward (sin yaw, cos yaw). */
function stickRel(p, lat, fwd) {
  const m = p.intent.move, s = Math.sin(p.yaw), c = Math.cos(p.yaw);
  m.x = lat * c + fwd * s; m.z = -lat * s + fwd * c;
  const l = Math.sqrt(m.x * m.x + m.z * m.z);
  if (l > 1) { m.x /= l; m.z /= l; }                       // the stick stays inside the unit disc
  m.mag = l > 1 ? 1 : l;
}

/** Stick toward (or away from, sign −1) the rim with magnitude mag. */
function stickRim(p, sign, mag) {
  dirTo(G, p.pos.x, p.pos.z, RIM.x, RIM.z);
  const m = p.intent.move;
  m.x = G.x * sign * mag; m.z = G.z * sign * mag; m.mag = mag;
}

function stopMove(it) { it.move.x = 0; it.move.z = 0; it.move.mag = 0; it.sprint = false; }

function silence(it) {
  stopMove(it);
  it.post = false; it.plain = false;
  if (it.primary.held) { it.primary.held = false; it.primary.heldTime = 0; }
  if (it.secondary.held) { it.secondary.held = false; it.secondary.heldTime = 0; }
  if (it.tertiary.held) { it.tertiary.held = false; it.tertiary.heldTime = 0; }
  clearEdges(it);
}

function tap(b, ms) { pressButton(b, ms); releaseButton(b, ms); }

// ------------------------------------------------------------------------------------------------ estimates (§5.10)

// ------------------------------------------------------------------------------------------------ passes (§5.10, R#34)

// ------------------------------------------------------------------------------------------------ shared per world

function shared(world) {
  return world.aiShared || (world.aiShared = makeShared());
}

/** Free-ball landing point at 1.8 m (a pass: at chest height), refreshed every 0.1 s, shared by everyone. */
function refreshLanding(S, world, dt) {
  const ball = world.ball, st = ball.state;
  if (st !== 'flight' && st !== 'loose' && st !== 'pass') { S.landValid = false; S.landCd = 0; S.landState = st; return; }
  S.landCd -= dt;
  if (S.landCd > 0 && S.landState === st) return;
  S.landCd = LAND_REFRESH; S.landState = st;
  const r = predictLanding(ball, st === 'pass' ? PASS_Y : LAND_Y, LAND_TMP);
  if (r) { S.landX = clamp(r.x, -CLAMP_X, CLAMP_X); S.landZ = clamp(r.z, CLAMP_Z_MIN, CLAMP_Z_MAX); S.landT = r.t; S.landValid = true; } else S.landValid = false;
}

// ------------------------------------------------------------------------------------------------ public API

/** Clears every countdown and plan of a player's AI state (R#35); creates the state on first use. */
export function resetAI(p) {
  const fresh = makeAiState();
  if (!p.ai || p.ai.gates === undefined) { p.ai = fresh; return; }
  const ai = p.ai, scores = ai.scores, gates = ai.gates;
  for (const k of Object.keys(fresh)) if (k !== 'scores' && k !== 'gates') ai[k] = fresh[k];
  for (const k of Object.keys(scores)) scores[k] = 0;
  for (const k of Object.keys(gates)) gates[k] = false;
}

/** §5.10 matchups: minimise Σ cost over the 6 permutations (physics.matchupCost), ties by roster order. */
export function assignMatchups(world, offense) {
  const roster = world.roster;
  if (!roster) return;
  const att = roster[offense], def = roster[1 - offense];
  let top = att[0];
  for (let i = 1; i < att.length; i++) if (att[i].legend.tend.checkShare > top.legend.tend.checkShare) top = att[i];
  let best = 0, bestC = Infinity;
  for (let k = 0; k < PERMS.length; k++) {
    const P = PERMS[k];
    let c = 0;
    for (let i = 0; i < 3; i++) c += matchupCost(def[i], att[P[i]], top);
    if (c < bestC - 1e-9) { bestC = c; best = k; }
  }
  for (let i = 0; i < 3; i++) { def[i].defAssign = att[PERMS[best][i]]; att[i].defAssign = null; }
}

/** Called right after a CPU SHOOT press resolved (game.js startShot): release at tIdeal + eT_cpu (§5.3.2). */
export function planCpuRelease(p, world) {
  const ai = p.ai;
  if (!ai) return;
  const s = p.shot;
  if (ai.pumpOn) return;                              // a planned pump fake keeps its quick release
  let hold = s.tIdeal + cpuReleaseError(world.rng, aiDiff(world, p).cpuSigma);
  if (world.shotClock < PANIC) hold = Math.min(hold, world.shotClock - FIXED_DT);
  if (hold < REL_MIN) hold = REL_MIN;
  ai.holdT = hold; ai.releaseCd = hold; ai.releaseOn = true;
}

/** `__game.ai(id)` snapshot (allocates). */
export function aiDebug(p) {
  const a = p.ai;
  if (!a) return { action: null, scores: {}, gates: {} };
  return { action: a.action, scores: Object.assign({}, a.scores), gates: Object.assign({}, a.gates) };
}

/** The utility table of the last handler decision (shared object). */
export function handlerScores() { return SCORES; }

/** One fixed step of the AI for every CPU player. */
export function updateAI(world, dt) {
  const ps = world.players, ball = world.ball;
  if (!ps || !ball) return;
  const S = shared(world);
  const live = world.state === 'LIVE';
  if (live && (!S.wasLive || S.offense !== world.offense)) {
    S.offense = world.offense; S.passSeen = -1; S.shotSeen = -1; S.crowdT = 0;
    for (let i = 0; i < ps.length; i++) newPossession(ps[i], world);
  }
  S.wasLive = live;
  if (!live) {
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (!p.ai || p.ai.gates === undefined) resetAI(p);
      if (userControls(world, p)) { p.ai.active = false; continue; }
      silence(p.intent); p.ai.hadBall = false; p.ai.releaseOn = false; p.ai.jumpOn = false; p.ai.pumpOn = false;
    }
    return;
  }
  refreshLanding(S, world, dt);
  trackPass(S, world);
  trackShot(S, world);
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (p.team !== world.offense) {
      const m = p.defAssign;
      if (!m || m.team !== world.offense) { assignMatchups(world, world.offense); break; }
    }
  }
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (!p.ai || p.ai.gates === undefined) resetAI(p);
    const ai = p.ai;
    if (userControls(world, p)) { ai.active = false; ai.hadBall = false; continue; }
    const it = p.intent;
    if (!ai.active) { ai.active = true; silence(it); ai.tick = i * FIXED_DT; }
    clearEdges(it);
    countdowns(ai, dt);
    let tick = false;
    ai.tick -= dt;
    if (ai.tick <= 1e-9) { tick = true; ai.tick += TICK; if (ai.tick <= 0) ai.tick = TICK; }
    const ms = world.time * 1000;
    if (it.primary.held) it.primary.heldTime += dt;
    if (it.secondary.held) it.secondary.heldTime += dt;
    if (p.team === world.offense) {
      if (p.hasBall && ball.owner === p) handler(p, ai, world, tick, ms, dt);
      else { if (ai.hadBall) leaveBall(p, ai, ms); offBall(p, ai, world, tick, ms, S); }
    } else {
      if (ai.hadBall) leaveBall(p, ai, ms);
      defence(p, ai, world, tick, ms, S);
    }
  }
  rematchCheck(world, S, dt);
}

function countdowns(ai, dt) {
  ai.holdCd -= dt; ai.setupCd -= dt; ai.catchCd -= dt; ai.passGateCd -= dt; ai.stealCd -= dt; ai.probeFlipCd -= dt;
  ai.cutCd -= dt; ai.cutT -= dt; ai.helpCd -= dt; ai.contestCd -= dt; ai.passHoldCd -= dt; ai.setFeetCd -= dt;
  ai.laneCd -= dt; ai.closeCd -= dt; ai.pokeCd -= dt; ai.closeDelayCd -= dt; ai.rebCd -= dt; ai.postAbandonCd -= dt; ai.spotCd -= dt;
  ai.releaseCd -= dt; ai.jumpCd -= dt; ai.pumpCd -= dt; ai.openCd -= dt; ai.laneDelayCd -= dt;
}

function newPossession(p, world) {
  const ai = p.ai || (p.ai = makeAiState());
  ai.action = 'probe'; ai.holdCd = 0; ai.setupCd = SETUP_T; ai.helpCd = 0; ai.jumpOn = false; ai.jumpShooter = null; ai.seenPress = -1;
  ai.closeCd = 0; ai.laneCd = 0; ai.cutT = 0; ai.cutCd = world.rng.range(CUT_MIN, CUT_MAX); ai.spot = null; ai.spotCd = 0;
  ai.crash = false; ai.crashShot = -1; ai.probeDir = 0; ai.doubleT = 0; ai.doubleRolled = false; ai.backdoor = false;
  p.cutting = false; p.slot = -1;
}

function leaveBall(p, ai, ms) {
  ai.hadBall = false; ai.releaseOn = false; ai.pumpOn = false;
  const it = p.intent;
  if (it.primary.held) releaseButton(it.primary, ms);
  if (it.secondary.held) releaseButton(it.secondary, ms);
  it.post = false; it.plain = false;
}

// ------------------------------------------------------------------------------------------------ the ball handler

function initHold(p, ai, world) {
  ai.hadBall = true; ai.action = 'probe'; ai.holdCd = 0; ai.catchCd = CATCH_GATE; ai.passGateCd = PASS_GATE;
  ai.isoLeft = isoMovesRoll(p, world.rng); ai.arcBand = arcBandRoll(p, world.rng); ai.jabRolled = false; ai.jabWant = false; ai.pumpDone = false; ai.plan = '';
  ai.releaseOn = false; ai.pumpOn = false; ai.ripWant = false; ai.bounces = 0; ai.forcePass = false; ai.doubleT = 0; ai.postT = 0; ai.postPlan = '';
  ai.upUnder = false; ai.driveFtRolled = false; ai.passTo = null; ai.wasPost = false; ai.ballT = 0; ai.forceThrow = false; ai.fadeNext = false;
  p.slot = -1; p.cutting = false; p.passTarget = null;
}

function handler(p, ai, world, tick, ms, dt) {
  const it = p.intent;
  if (!ai.hadBall) initHold(p, ai, world);
  it.post = false;
  ai.ballT += dt;
  if (p.dribbleBounced && p.dribbling) ai.bounces++;
  // a shot in progress: hold the button to the planned release (pump fakes: quick release)
  if (p.shot.active) {
    stopMove(it);
    if (it.primary.held) {
      if (ai.pumpOn && ai.pumpCd <= 1e-9) { releaseButton(it.primary, it.primary.pressTs + PUMP_TAP * 1000); ai.pumpOn = false; }
      else if (ai.releaseOn && ai.releaseCd <= 1e-9) { releaseButton(it.primary, it.primary.pressTs + ai.holdT * 1000); ai.releaseOn = false; }
    }
    return;
  }
  if (it.primary.held) { releaseButton(it.primary, ms); ai.releaseOn = false; ai.pumpOn = false; }
  if (ai.passHoldCd > 0 || it.secondary.held) {
    stopMove(it);
    if (ai.passHoldCd <= 0 && it.secondary.held) { p.passTarget = ai.passTo; releaseButton(it.secondary, ms); }
    return;
  }
  const st = p.state;
  if (p.isJumping || p.passAct.active || st === 'stunned' || st === 'fallen' || st === 'celebrate' || st === 'faceUp') { stopMove(it); return; }
  if (st === 'cross') { inMove(p, ai, world, tick, ms); return; }
  const sc = world.shotClock;
  if (isUsersTeammate(p, world)) {
    stopMove(it);
    if (sc < URGENT && (ai.catchCd <= 0 || sc <= URGENT_GATE)) shoot(p, ai, world, ms, true);
    else if (ai.catchCd <= CATCH_GATE - TEAMMATE_PASS_T) doPass(p, ai, world, ms, world.userPlayer, false);
    return;
  }
  if (st === 'post') { postPlay(p, ai, world, tick, ms, dt); return; }
  ai.wasPost = false;
  // double team tracking (post or paint, two defenders within 1.5 m for 0.3 s)
  if ((inPaint(p)) && doubled(p, world)) { ai.doubleT += dt; if (ai.doubleT >= DOUBLE_T) ai.forcePass = true; } else ai.doubleT = 0;
  const urgent = sc < URGENT;
  if (tick && (urgent || ai.holdCd <= 0 || ai.forcePass)) decide(p, ai, world, urgent);
  execute(p, ai, world, tick, ms);
}

function isUsersTeammate(p, world) {
  if (world.auto || !world.userPlayer || world.userPlayer === p) return false;
  return world.user === p.team && world.offense === p.team;
}

/**
 * The handler decision (§5.10): gates, EP-based utilities with tendencies, argmax with noise and hysteresis.
 */
function decide(p, ai, world, urgent) {
  const rng = world.rng, sc = world.shotClock, diff = aiDiff(world, p), T = tendOf(p);
  const g = onBallDefender(p, world);
  const gd = g ? distXZ(g.pos.x, g.pos.z, p.pos.x, p.pos.z) : OPEN_MAX;
  const d = rimD(p);
  const setupG = ai.setupCd > 0, catchG = ai.catchCd > 0 && sc > URGENT_GATE;
  const clearing = world.rules && world.rules.clear && !world.cleared && world.clearPending === p.team;
  const open = openness(p, world);
  const isoG = ai.isoLeft > 0 && gd <= ISO_R;
  const patienceG = world.liveT < T.patience * PATIENCE_TUNE && open < PATIENCE_OPEN;
  ai.gates.setup = setupG; ai.gates.catch = catchG; ai.gates.iso = isoG; ai.gates.patience = patienceG;
  const sc0 = SCORES;
  sc0.shoot = 0; sc0.drive = 0; sc0.move = 0; sc0.jab = 0; sc0.post = 0; sc0.pass = 0; sc0.probe = 0; sc0.reset = 0;
  let best = 'probe', bestU = -Infinity;
  if (ai.fadeNext && !urgent && !clearing) {
    // the gather is done: the fadeaway now (the shot was already decided before the gather)
    ai.fadeNext = false;
    if (p.holding) { best = 'shoot'; ai.plan = 'fade'; }
  } else if (urgent && !clearing) {
    // the best SHOOT now — but a gated three (Yao, Giannis closed) attacks inside first while the clock allows, and
    // Yao stranded beyond the arc kicks it to a teammate while a catch-and-shoot still fits (≥ 1.0 s)
    best = isThree(p.pos.x, p.pos.z) && !threeGateOK(p, open, sc) ? 'drive' : 'shoot';
    // with time for one attack (≥ 1.8 s) a better drive beats the heave from where he stands (EP vs EP)
    if (best === 'shoot' && sc >= URGENT_DRIVE_CLOCK && !p.legend.traits.noDribbleMoves) {
      const e = epAt(p, world, p.pos.x, p.pos.z, p.vel.x, p.vel.z, false, true);
      const g0 = onBallDefender(p, world);
      if (uDrive(p, g0, world, diff, 0, false) > e.ep + URGENT_DRIVE_MARGIN) best = 'drive';
    }
    if (postAlways(p) && isThree(p.pos.x, p.pos.z) && sc >= YAO_KICK_CLOCK) {
      const q = bestPassTarget(p, world, PASS_OUT) || safestMate(p, world);
      if (q) { best = 'pass'; ai.passTo = q; ai.passLob = false; ai.forceThrow = true; }
    }
  } else if (setupG) {
    best = 'setup';
  } else if (clearing) {
    // R9: Yao (2 dribbles per hold) outlets to a teammate beyond the arc instead of dribbling out
    best = 'clear';
    if (postAlways(p) && ai.passGateCd <= 0 && bestPassTarget(p, world, PASS_OUT, true)) { best = 'pass'; ai.passTo = PASS_OUT.player; ai.passLob = false; }
  } else {
    // shoot
    const e = epAt(p, world, p.pos.x, p.pos.z, p.vel.x, p.vel.z, false, true);
    const three = e.pts === 3;
    let ep0 = e.ep;
    // a fadeaway taker holding the ball with his guard up reads the fade (its contest multipliers), not the set shot
    if (p.holding && T.fade >= TRIPLE_FADE && g && gd <= FADE_R && !inPaint(p)) {
      const pf = estMake(p, world, 'fade', null, p.pos.x, p.pos.z, 0, 0, true);
      if (pf * e.pts > ep0) ep0 = pf * e.pts;
    }
    let uShoot = ep0 * zoneTend(p, e.zone) * clutchShotMul(p, world) * dietFactor(p, world, e.zone);
    sc0.shoot = uShoot;
    const gateOK = !catchG && (!three || threeGateOK(p, open, sc));
    const th = theta(sc) + (patienceG ? PATIENCE_ADD : 0);
    const isoOK = !isoG || ep0 >= theta(sc) + ISO_EXTRA;
    if (gateOK && isoOK && uShoot >= th) { const u = uShoot + rng.range(0, NOISE); if (u > bestU) { bestU = u; best = 'shoot'; } }
    // drive
    let uDr = 0;
    // a started drive that is inside 6 m or past its guard is committed: it attacks the help (finish / floater /
    // kick-out on equal terms) instead of being called off by the lane gate, which only governs starting a drive
    // (LeBron / Giannis / Yao ignore the lane gate anyway: their drive commits only while the lane is clear)
    const big = laneGateFree(p);
    // (I3) a non-big's drive also stays committed while it is still attacking: ≥ 3 m/s within 45° of the rim
    const committed = ai.action === 'drive' && (big ? laneClear(p, g, world) : (guardBeaten(p, g) || (p.speed >= HELP_DRIVE_V && headingCos(p) >= COS45)));
    if (p.legend.id !== 'yao' || ai.bounces < MAX_YAO_BOUNCES) uDr = uDrive(p, g, world, diff, 0, committed);
    // the commitment follows the shot diet: a legend above his rim share pulls up more readily
    if (committed && uDr > 0) uDr += (DRIVE_COMMIT + (d < DRIVE_COMMIT_D ? DRIVE_COMMIT_NEAR : 0)) * dietFactor(p, world, 'rim');
    sc0.drive = uDr;
    // patience covers the drive too: inside the patience window a drive against a set guard must clear the same bar
    // as a contested shot, θ(shot clock) + 0.5 (a committed drive keeps going; a beaten guard raises U_drive through
    // pBeat 0.90, so a clear advantage still clears the bar)
    const drivePatient = patienceG && !committed && uDr < th;
    if (uDr > 0 && !drivePatient) { const u = uDr + rng.range(0, NOISE); if (u > bestU) { bestU = u; best = 'drive'; } }
    // dribble move (the hold's isoMoves budget, §2.5, caps them: Kyrie 2–4 a hold, Kobe / Jordan 1–2)
    let uMv = 0;
    if (p.dribbling && g && gd <= ISO_R && !p.legend.traits.noDribbleMoves && p.moveCd <= 0 && T.iso > 0 && ai.isoLeft > 0) {
      SHAKE_OPTS.committed = false; SHAKE_OPTS.combo = 1; SHAKE_OPTS.diffMul = shakeDiffMul(world, p, g);
      const ps = shakeChance(p, g, 'move.cross', SHAKE_OPTS).pShake;
      uMv = (uDrive(p, g, world, diff, PBEAT_BEATEN) * ps + MOVE_ELSE * (1 - ps)) * T.iso;
      sc0.move = uMv;
      const u = uMv + rng.range(0, NOISE);
      if (u > bestU) { bestU = u; best = 'move'; }
    }
    // jab (holding, ≤ 2 per hold; tend.jab is a per-hold probability)
    if (p.holding && g && gd <= JAB_R && p.cx.jabsThisHold < MAX_JABS && T.jab > 0) {
      if (!ai.jabRolled) { ai.jabRolled = true; ai.jabWant = rng.next() < T.jab; }
      const uJ = ai.jabWant ? U_JAB : 0;
      sc0.jab = uJ;
      if (uJ > 0) { const u = uJ + rng.range(0, NOISE); if (u > bestU) { bestU = u; best = 'jab'; } }
    }
    // post-up
    const fd = frontDefenderOf(p, world);
    if (!catchG && d <= POST_MAX_D && T.post > 0 && (postAlways(p) || isMismatch(p, g) || isMismatch(p, fd))) {
      const uP = 2 * postEst(p, world, g) * T.post * dietFactor(p, world, POST_DIST_ZONE(p));
      sc0.post = uP;
      const u = uP + rng.range(0, NOISE);
      if (u > bestU) { bestU = u; best = 'post'; }
    }
    // pass
    if (!catchG && ai.passGateCd <= 0) {
      const recv = bestPassTarget(p, world, PASS_OUT);
      if (recv) {
        let uPa = PASS_OUT.score;
        if (ai.forcePass) uPa *= 1 + T.kickWhenDoubled;
        sc0.pass = uPa;
        // ball movement: after holding it SWING_T / tend.pass seconds without a better option the handler swings
        // the ball to a safe receiver (a probe-level utility + SWING_ADD); not late in the clock (≤ 6 s), where a
        // swing only hands the receiver an urgent heave
        if (sc > PROBE_LATE_CLOCK && ai.ballT >= SWING_T / tendOf(p).pass && PASS_OUT.ep >= SWING_EP) uPa = Math.max(uPa, U_PROBE + SWING_ADD);
        sc0.pass = uPa;
        const need = Math.max(sc0.shoot >= th ? sc0.shoot : 0, uDr, uMv) + (ai.forcePass ? 0 : PASS_MARGIN);
        if (uPa >= need) {
          const u = uPa + rng.range(0, NOISE);
          if (u > bestU || ai.forcePass) { bestU = u; best = 'pass'; ai.passTo = recv; ai.passLob = PASS_OUT.lob; }
        }
      }
    }
    // probe / reset
    const uPr = U_PROBE * (sc <= PROBE_LATE_CLOCK ? U_PROBE_LATE : 1);
    sc0.probe = uPr;
    { const u = uPr + rng.range(0, NOISE); if (u > bestU) { bestU = u; best = 'probe'; } }
    if (gd < RESET_R && sc > RESET_CLOCK && d < RESET_D) sc0.reset = U_RESET;
    ai.forcePass = false;
  }
  const s = ai.scores;
  s.shoot = sc0.shoot; s.drive = sc0.drive; s.move = sc0.move; s.jab = sc0.jab; s.post = sc0.post; s.pass = sc0.pass; s.probe = sc0.probe;
  if (best !== ai.action) {
    if (best === 'drive') startDrive(p, ai, world, diff);
    if (best === 'post') { ai.postAbandonCd = POST_ABANDON; }
    if (best === 'shoot' && ai.plan !== 'fade') { ai.plan = ''; ai.setFeetCd = SETFEET_T; }
    ai.action = best;
    ai.holdCd = HYSTERESIS;
  }
}

/**
 * After a pump fake in the paint: the up-and-under (a rim finish) with p UPUNDER_P × the rim diet, else the
 * follow-up is decided again (Yao: the hook) — keeps Yao's finishes near his profile (hooks, few rim shots).
 */
function upUnderRoll(p, world, d) {
  return d <= PUMP_UPUNDER_D && world.rng.next() < UPUNDER_P * dietFactor(p, world, 'rim');
}

/** The teammate with the lowest pass risk (no tolerance: Yao's clock-forced kick-out beats his heave). */
function safestMate(p, world) {
  const ps = world.players;
  let best = null, br = Infinity;
  for (let i = 0; i < ps.length; i++) {
    const q = ps[i];
    if (q === p || q.team !== p.team || q.disabled) continue;
    const r = passRisk(p, q, q.pos.x, q.pos.z, world);
    if (r < br) { br = r; best = q; }
  }
  return best;
}

function shakeDiffMul(world, h, d) {
  const hu = userControls(world, h), du = userControls(world, d);
  if (!hu && du) return aiDiff(world, h).cpuShakeMul;
  return 1;
}


function startDrive(p, ai, world, diff) {
  const rng = world.rng;
  ai.driveSprint = rng.next() < diff.sprintProb;
  ai.driveSide = driveSideRoll(p, rng);
  ai.driveEuro = has(p, 'giannis.euro') && rng.next() < TRIGGERS.EURO.AI_P;
  ai.driveFtRolled = false;
  ai.finishD = DRIVE_FINISH_LO + DRIVE_FINISH_SPAN * rng.next();
}

function execute(p, ai, world, tick, ms) {
  const it = p.intent;
  stopMove(it);
  switch (ai.action) {
    case 'setup': break;                                   // triple threat; the player faces the rim
    case 'clear': {                                        // R9: dribble beyond the arc before anything else
      dirTo(G, RIM.x, RIM.z, p.pos.x, p.pos.z);
      A.x = RIM.x + G.x * (LINES.THREE_R + 0.8); A.z = RIM.z + G.z * (LINES.THREE_R + 0.8);
      clampCourt(A);
      steerTo(p, A.x, A.z, false);
      break;
    }
    case 'shoot': shoot(p, ai, world, ms, false); break;
    case 'drive': drive(p, ai, world, tick, ms); break;
    case 'move': doMove(p, ai, world, ms); break;
    case 'jab': doJab(p, ai, world, ms); break;
    case 'post': postEntry(p, ai, world, ms); break;
    case 'pass': doPass(p, ai, world, ms, ai.passTo, ai.passLob); break;
    default: probe(p, ai, world, tick);
  }
}

/** SHOOT with the variant plan (§5.10): pump fake, fade, stepback, jab pull-up, set-feet brake. */
function shoot(p, ai, world, ms, urgentNow) {
  const it = p.intent, rng = world.rng, T = tendOf(p);
  if (!(p.state === 'idle' || p.state === 'move' || p.state === 'post' || p.state === 'cross')) return;
  const sc = world.shotClock;
  const urgent = urgentNow || sc < URGENT;
  if (sc > URGENT_GATE && ai.catchCd > 0) return;
  const g = onBallDefender(p, world);
  const gd = g ? distXZ(g.pos.x, g.pos.z, p.pos.x, p.pos.z) : OPEN_MAX;
  const d = rimD(p);
  if (ai.plan === '') {
    ai.plan = 'plain';
    if (!urgent && d > TRIGGERS.LAYUP.STD1_MAX) {
      const jumpShot = predictKind(p, world, p.pos.x, p.pos.z, false).kind === 'jumper';
      if (jumpShot && gd <= PUMP_R && !ai.pumpDone && rng.next() < T.pumpFake) ai.plan = 'pump';
      else if (p.holding && gd <= FADE_R && rng.next() < T.fade) ai.plan = 'fade';
      // the fadeaway from the dribble (Kobe, Jordan): gather the ball with a shot fake, then fade away (the fade
      // needs the ball in the hands, §5.9 row 14)
      else if (jumpShot && p.dribbling && T.fade >= TRIPLE_FADE && gd <= FADE_R && !ai.pumpDone && rng.next() < T.fade) { ai.plan = 'pump'; ai.fadeNext = true; }
      else if (p.dribbling && gd <= STEPBACK_R && rng.next() < T.stepback) ai.plan = 'stepback';
    }
  }
  // set-feet brake (R#25): moving fast with nobody within 1.0 m → stop up to 0.35 s before pressing
  if (ai.plan === 'plain' && !urgent && p.speed > SETFEET_V && gd > SETFEET_CLEAR && d > TRIGGERS.LAYUP.STD1_MAX && ai.setFeetCd > 0) {
    stopMove(it);
    return;
  }
  // the three gate is re-checked at the press (a closeout since the decision: Giannis no longer open → re-decide)
  if (!urgent && isThree(p.pos.x, p.pos.z) && !threeGateOK(p, openness(p, world), sc)) { ai.action = 'probe'; ai.holdCd = 0; ai.plan = ''; return; }
  stopMove(it);
  it.plain = true;
  if (ai.plan === 'fade' || ai.plan === 'stepback') stickRim(p, -1, 1);
  else if (d <= TRIGGERS.LAYUP.STD1_MAX) stickRim(p, 1, 0.6);
  pressButton(it.primary, ms);
  ai.pumpOn = ai.plan === 'pump';
  if (ai.pumpOn) { ai.pumpCd = PUMP_TAP; ai.pumpDone = true; ai.upUnder = upUnderRoll(p, world, d); }
  ai.action = ai.pumpOn ? 'probe' : 'shoot';
  ai.holdCd = ai.pumpOn ? PUMP_REDECIDE : HYSTERESIS;
  ai.plan = '';
}

/** PROBE (v1 §7.1, bands by profile): dribble along the arc toward space; RESET backs out when the guard crowds early. */
function probe(p, ai, world, tick) {
  const T = tendOf(p);
  const d = rimD(p);
  dirTo(G, p.pos.x, p.pos.z, RIM.x, RIM.z);
  const g = onBallDefender(p, world);
  const gd = g ? distXZ(g.pos.x, g.pos.z, p.pos.x, p.pos.z) : OPEN_MAX;
  if (p.id === 'yao' && ai.bounces >= MAX_YAO_BOUNCES && p.dribbling) { stopMove(p.intent); return; }
  // the triple-threat series (Kobe, Jordan: jab ≥ 0.4, fade ≥ 0.5): with the guard up on him and the ball still in
  // his hands he stays put for up to TRIPLE_T — jab, jab, fadeaway or the rip-through — instead of putting it down
  if (p.holding && T.jab >= TRIPLE_JAB && T.fade >= TRIPLE_FADE && g && gd <= JAB_R + 0.3 && ai.ballT < TRIPLE_T && d < TRIPLE_D) {
    stopMove(p.intent);
    return;
  }
  if (p.id === 'yao') {                                     // Yao probes toward the block on his side
    const sp = topSpot('yao');
    const side = p.pos.x > 0.5 ? 1 : p.pos.x < -0.5 ? -1 : (sp.x < 0 ? -1 : 1);
    steerTo(p, side * Math.abs(sp.x), POST_SPOT_Z, false);
    return;
  }
  if (gd < RESET_R && world.shotClock > RESET_CLOCK && d < RESET_D) {
    A.x = RIM.x - G.x * RESET_OUT_D; A.z = RIM.z - G.z * RESET_OUT_D;
    clampCourt(A);
    steerTo(p, A.x, A.z, false);
    return;
  }
  const sx = -G.z, sz = G.x;                                // tangent of the arc
  if (tick || ai.probeDir === 0) {
    const sR = sideSpace(p, world, sx, sz, 1), sL = sideSpace(p, world, sx, sz, -1);
    if (ai.probeDir === 0) ai.probeDir = sR >= sL ? 1 : -1;
    else if (ai.probeFlipCd <= 0) {
      const cur = ai.probeDir > 0 ? sR : sL, oth = ai.probeDir > 0 ? sL : sR;
      if (cur < 1.0 && oth > cur + 0.5) { ai.probeDir = -ai.probeDir; ai.probeFlipCd = HYSTERESIS; }
    }
  }
  const band = probeBand(p, ai.arcBand);
  A.x = p.pos.x + sx * ai.probeDir * PROBE_STEP; A.z = p.pos.z + sz * ai.probeDir * PROBE_STEP;
  if (d < band[0]) { A.x -= G.x * (band[0] - d); A.z -= G.z * (band[0] - d); } else if (d > band[1]) { A.x += G.x * (d - band[1]); A.z += G.z * (d - band[1]); }
  clampCourt(A);
  if (distXZ(A.x, A.z, p.pos.x, p.pos.z) < 0.4 && ai.probeFlipCd <= 0) {
    ai.probeDir = -ai.probeDir; ai.probeFlipCd = HYSTERESIS;
    A.x = p.pos.x + sx * ai.probeDir * PROBE_STEP; A.z = p.pos.z + sz * ai.probeDir * PROBE_STEP;
    clampCourt(A);
  }
  steerTo(p, A.x, A.z, false, T.iso > 1 ? PROBE_MAG_ISO : PROBE_MAG);
}

/** Free space on one side: nearest opponent to the point 2 m along ±tangent (0 when off the court). */
function sideSpace(p, world, sx, sz, sign) {
  const px = p.pos.x + sx * sign * PROBE_SPACE_R, pz = p.pos.z + sz * sign * PROBE_SPACE_R;
  if (Math.abs(px) > CLAMP_X || pz < CLAMP_Z_MIN || pz > CLAMP_Z_MAX) return 0;
  const ps = world.players;
  let best = OPEN_MAX;
  for (let i = 0; i < ps.length; i++) {
    const o = ps[i];
    if (o.team === p.team) continue;
    const dd = distXZ(px, pz, o.pos.x, o.pos.z);
    if (dd < best) best = dd;
  }
  return best;
}

/**
 * DRIVE: attack the rim around the guard (driveRight side), sprint with sprintProb; finishes: Jordan FT-line dunk
 * (p 0.25 per eligible approach), Giannis long gather / euro (35 % of drives), dunk when allowed, floater over a rim
 * protector when its EP beats the layup, else the layup at the drive's finish distance.
 */
function drive(p, ai, world, tick, ms) {
  const d = rimD(p);
  dirTo(G, p.pos.x, p.pos.z, RIM.x, RIM.z);
  const g = onBallDefender(p, world);
  // path: around the guard while he is still in front
  A.x = RIM.x - G.x * DRIVE_STOP; A.z = RIM.z - G.z * DRIVE_STOP;
  if (g && !guardBeaten(p, g) && d > 3.0) {
    const s = ai.driveSide;            // right of the drive line = (−Gz, Gx)
    A.x = g.pos.x - G.z * s * DRIVE_AROUND + G.x * 1.5; A.z = g.pos.z + G.x * s * DRIVE_AROUND + G.z * 1.5;
  }
  clampCourt(A);
  // an open runway sets up the signature long finishes (Giannis' long gather ≥ 5 m/s, Jordan's FT-line dunk ≥ 6 m/s):
  // the driver always sprints when no defender is within the path radius of his line to the rim
  const runway = d <= RUNWAY_D && (has(p, 'giannis.longDunk') || has(p, 'jordan.ftDunk')) && pathClear(p, world, TRIGGERS.LONG_GATHER.PATH_R);
  steerTo(p, A.x, A.z, (ai.driveSprint || runway) && d > 1.6);
  if (p.state !== 'idle' && p.state !== 'move') return;
  if (ai.catchCd > 0 && world.shotClock > URGENT_GATE) return;   // catch gate (R#25 / R#40)
  const c = abilityCtx(p, world);
  // signature finishes
  if (!ai.driveFtRolled && has(p, 'jordan.ftDunk') && eligible(p, 'jordan.ftDunk', c)) {
    ai.driveFtRolled = true;
    if (world.rng.next() < TRIGGERS.FT_DUNK.AI_P) { pressFinish(p, ai, ms, false, 1); return; }
  }
  if (has(p, 'giannis.longDunk') && eligible(p, 'giannis.longDunk', c)) { pressFinish(p, ai, ms, false, 1); return; }
  if (ai.driveEuro && has(p, 'giannis.euro') && d <= 6.8 && eligible(p, 'giannis.euro', c)) { pressFinish(p, ai, ms, false, 1); return; }
  {
    // generic finishes: the floater over a rim protector is weighed first (EP × tend.shotClose × diet against the
    // finish's EP × tend.shotRim × diet, the dunk included), then the dunk, then the layup
    const sp = p.speed, hc = headingCos(p);
    const dunkOK = d >= TRIGGERS.DUNK.D_MIN && d <= DRIVE_DUNK_D && dunkAllowed(p, world, d);
    if (d > FLOATER_LO && d <= FLOATER_HI && p.dribbling && sp >= 3.0 && rimProtectorHome(p, world)) {
      const T = tendOf(p);
      const pf = estMake(p, world, 'floater', null, p.pos.x, p.pos.z, p.vel.x, p.vel.z, true) * T.shotClose * dietFactor(p, world, 'close');
      const pFin = dunkOK ? Math.max(finishEst(p, world, onBallDefender(p, world)), estMake(p, world, 'dunk', 'power2', p.pos.x, p.pos.z, p.vel.x, p.vel.z, true))
        : finishEst(p, world, onBallDefender(p, world));
      if (pf > pFin * T.shotRim * dietFactor(p, world, 'rim')) { pressFinish(p, ai, ms, true, 1); return; }
    }
    if (dunkOK) { pressFinish(p, ai, ms, true, 0); return; }
    const std2 = sp >= STD2_SPEED && hc >= COS45 && d <= (p.id === 'jordan' ? TRIGGERS.LAYUP.STD2_MAX_JORDAN : TRIGGERS.LAYUP.STD2_MAX);
    // Kyrie's floater row is automatic inside (2.2, 4.5] with a rim protector home: his layups go up from ≤ 2.2 m
    const kyrieAuto = has(p, 'kyrie.finisher') && rimProtectorHome(p, world);
    const fd = kyrieAuto ? Math.min(ai.finishD, FLOATER_ROW_D) : ai.finishD;
    if (d <= Math.min(fd, TRIGGERS.LAYUP.STD1_MAX) || (std2 && d <= fd) || d <= 1.6) { pressFinish(p, ai, ms, true, 0); return; }
  }
  // stalled drive (the help closed the lane far out): re-decide next tick
  if (tick && p.speed < 1.0 && d > 3.0) ai.holdCd = 0;
}


/**
 * Press SHOOT for a drive finish; `plain` suppresses the signature trigger rows; `toward` = stick toward the rim
 * (1: the floater row 8 may fire over a rim protector; 0: neutral stick → dunk / layup rows).
 */
function pressFinish(p, ai, ms, plain, toward) {
  const it = p.intent;
  if (toward) stickRim(p, 1, 1); else stopMove(it);
  it.plain = plain;
  pressButton(it.primary, ms);
  ai.pumpOn = false;
  ai.action = 'shoot'; ai.holdCd = HYSTERESIS;
}

/** Dribble move (§5.7): CROSS with the stick toward the off hand (away from the guard's side); budget − 1. */
function doMove(p, ai, world, ms) {
  const it = p.intent;
  if (p.state !== 'idle' && p.state !== 'move') { ai.action = 'probe'; return; }
  if (p.moveCd > 0 || !p.dribbling) { ai.action = 'probe'; return; }
  const handL = p.animator && p.animator.ballHand === 2;
  // the off hand: + lat (left) when the ball is in the right hand
  const lat = handL ? -0.9 : 0.9;
  const rng = world.rng;
  const T = tendOf(p);
  const g = onBallDefender(p, world);
  const gd = g ? distXZ(g.pos.x, g.pos.z, p.pos.x, p.pos.z) : OPEN_MAX;
  // Kyrie sometimes opens with the double-btl stepback (stick back toward the off hand) when crowded
  const back = p.id === 'kyrie' && gd <= 1.2 && rng.next() < T.stepback * 0.5;
  stickRel(p, lat, back ? -0.8 : 0.2);
  tap(it.tertiary, ms);
  ai.isoLeft--;
  ai.action = 'probe'; ai.holdCd = HYSTERESIS;
}

/** Inside a move: Kyrie / combo players queue the next move with a second CROSS (§5.7 combos). */
function inMove(p, ai, world, tick, ms) {
  const it = p.intent;
  stopMove(it);
  const id = p.move.id, age = world.time - p.move.startT;
  // up-and-under after a pump fake in the paint (§5.7, row 18)
  if (ai.upUnder && p.move.active && !(ai.catchCd > 0 && world.shotClock > URGENT_GATE) && (id === 'move.pumpFake' || id === 'sig.yao.pumpHook') && age >= UPUNDER_AFTER
    && world.time - p.cx.lastPumpFakeT <= PUMP_FAKE_UPUNDER - 0.05 && rimD(p) <= PUMP_UPUNDER_D) {
    ai.upUnder = false;
    stickRim(p, 1, 0.6);
    pressButton(it.primary, ms); ai.pumpOn = false;
    return;
  }
  // Kobe's rip-through after the second jab, past the clip's cancel point (§5.8 kobe.jab)
  if (ai.ripWant && p.holding && p.cx.jabsThisHold >= MAX_JABS && p.move.active && id.indexOf('jab') >= 0 && age >= p.move.cancelT) {
    stickRim(p, 1, 1); it.sprint = true;
    return;
  }
  if (!tick || !p.move.active || !p.dribbling || p.cx.queued || ai.isoLeft <= 0) return;
  const chain = p.id === 'kyrie' ? 3 : p.legend.traits.noDribbleMoves ? 0 : 2;
  if (p.cx.comboIndex >= chain) return;
  const g = onBallDefender(p, world);
  if (!g || distXZ(g.pos.x, g.pos.z, p.pos.x, p.pos.z) > ISO_R + 0.5) return;
  const T = tendOf(p);
  if (world.rng.next() >= T.iso * 0.45) return;             // Kyrie 0.63, Kobe 0.50, Jordan 0.45 per tick
  tap(it.tertiary, ms);                                      // neutral stick: the alternate direction
  ai.isoLeft--;
}

/** Jab (§5.7, kobe.jab): CROSS while holding, stick neutral; the next jab is rolled again with tend.jab. */
function doJab(p, ai, world, ms) {
  const it = p.intent;
  if (!p.holding || (p.state !== 'idle' && p.state !== 'move')) { ai.action = 'probe'; return; }
  stopMove(it);
  tap(it.tertiary, ms);
  ai.jabRolled = false;
  ai.ripWant = p.id === 'kobe' && p.cx.jabsThisHold >= 1 && world.rng.next() < RIP_P;
  ai.action = 'probe'; ai.holdCd = JAB_REDECIDE;
}

/** PASS (§5.10): publish the receiver as player.passTarget and tap PASS (lob: hold ≥ 0.30 s). */
function doPass(p, ai, world, ms, recv, lob) {
  const it = p.intent;
  if (!recv || recv === p || !p.hasBall) { ai.action = 'probe'; return; }
  if (p.state !== 'idle' && p.state !== 'move' && p.state !== 'post') { ai.action = 'probe'; return; }
  // the lane is re-checked on the step the pass is thrown (stale decisions are dropped)
  if (!isUsersTeammate(p, world) && !ai.forceThrow) {
    const tf = distXZ(p.pos.x, p.pos.z, recv.pos.x, recv.pos.z) / p.attrs.passSpeed + p.attrs.passRelease;
    const cx = clamp(recv.pos.x + recv.vel.x * tf, -CLAMP_X, CLAMP_X), cz = clamp(recv.pos.z + recv.vel.z * tf, CLAMP_Z_MIN, CLAMP_Z_MAX);
    const tol = riskTolOf(p, aiDiff(world, p));
    if (passRisk(p, recv, cx, cz, world) > tol || (recv.speed > LEAD_V && passRisk(p, recv, recv.pos.x, recv.pos.z, world) > tol)) { ai.action = 'probe'; ai.holdCd = 0; return; }
  }
  stopMove(it);
  ai.forceThrow = false;
  p.passTarget = recv; ai.passTo = recv;
  if (lob) { pressButton(it.secondary, ms); ai.passHoldCd = LOB_HOLD; } else tap(it.secondary, ms);
  ai.action = 'probe'; ai.holdCd = HYSTERESIS;
}

// ------------------------------------------------------------------------------------------------ post play (§5.6)

function postEntry(p, ai, world, ms) {
  const it = p.intent;
  const side = p.pos.x >= 0 ? 1 : -1;
  const entryD = postEntryD(p) - 0.3;
  const d = rimD(p);
  if (ai.bounces >= MAX_YAO_BOUNCES && p.id === 'yao' && p.dribbling && d > entryD) { ai.action = 'probe'; ai.holdCd = 0; return; }
  if (d > entryD) { steerTo(p, side * POST_SPOT_X, POST_SPOT_Z, false); ai.postAbandonCd = POST_ABANDON; return; }
  // inside the entry distance: request the post-up with the stick at the rim (detector: defender within 1.2 m in front)
  it.post = true;
  stickRim(p, 1, POST_STICK);
  it.sprint = false;
  if (ai.postAbandonCd <= 0) { ai.action = 'probe'; ai.holdCd = HYSTERESIS; it.post = false; }
}

/**
 * In the post: back down (shoves every 0.3 s), then the post shot at depth / after the backdown time: Yao hook, drop
 * step or pump-hook → up-and-under; Kobe post fade; others turnaround fade; kick out when doubled.
 */
function postPlay(p, ai, world, tick, ms, dt) {
  const it = p.intent, rng = world.rng, T = tendOf(p);
  if (!ai.wasPost) {
    ai.wasPost = true; ai.postT = 0; ai.postTime = POST_T_MIN + POST_T_SPAN * rng.next(); ai.postPlan = '';
    ai.doubleRolled = false;
  }
  ai.postT += dt;
  const d = rimD(p);
  const depth = p.id === 'yao' ? POST_DEPTH_YAO : POST_DEPTH;
  it.post = true;
  stickRim(p, 1, POST_STICK);
  if (!tick) return;
  // doubled → kick out
  if (doubled(p, world)) {
    ai.doubleT += TICK;
    if (ai.doubleT >= DOUBLE_T) {
      const recv = bestPassTarget(p, world, PASS_OUT);
      if (recv && rng.next() < T.kickWhenDoubled) { it.post = false; doPass(p, ai, world, ms, recv, false); return; }
    }
  } else ai.doubleT = 0;
  const sc = world.shotClock;
  // U_pass vs U_post (§5.10) from the post: an open teammate beats the post move by the pass margin
  if (ai.passGateCd <= 0 && (ai.catchCd <= 0 || sc <= URGENT_GATE) && sc >= URGENT && bestPassTarget(p, world, PASS_OUT)) {
    const g = onBallDefender(p, world);
    const uPost = 2 * postEst(p, world, g) * T.post;
    if (PASS_OUT.score >= uPost + PASS_MARGIN) { it.post = false; doPass(p, ai, world, ms, PASS_OUT.player, false); ai.passGateCd = PASS_GATE; return; }
  }
  // the post move comes after at least one shove (POST.SHOVE_T) unless the clock is short
  if (!(sc < 4 || ai.postT >= POST_T_MAX || (ai.postT >= POST_T_FIRST && (ai.postT >= ai.postTime || d <= depth)))) return;
  if (ai.catchCd > 0 && sc > URGENT_GATE) return;
  // choose the post move by EP: shot over the defender vs drop step (layup at the rim side)
  if (ai.postPlan === '') {
    const g = onBallDefender(p, world);
    const k = predictKind(p, world, p.pos.x, p.pos.z, true);
    const pShot = estMake(p, world, k.kind, k.variant, p.pos.x, p.pos.z, 0, 0, true);
    dirTo(G, p.pos.x, p.pos.z, RIM.x, RIM.z);
    const dx = p.pos.x + G.x * 1.0, dz = p.pos.z + G.z * 1.0;
    const pDrop = estMake(p, world, 'layup', 'power', dx, dz, 0, 0, false) * (g && !guardBeaten(p, g) ? 0.85 : 1);
    // weighed with the legend's shot diet (Yao's profile: hooks and jumpers, few rim finishes)
    const wDrop = pDrop * dietFactor(p, world, 'rim'), wShot = pShot * dietFactor(p, world, POST_DIST_ZONE(p));
    ai.postPlan = wDrop > wShot + rng.range(-0.08, 0.08) ? 'drop' : 'shot';
    if (ai.postPlan === 'shot' && g && distXZ(g.pos.x, g.pos.z, p.pos.x, p.pos.z) <= PUMP_R && rng.next() < T.pumpFake) ai.postPlan = 'pump';
  }
  it.post = false;
  stopMove(it);
  if (ai.postPlan === 'drop') {
    if (p.id === 'yao' && rng.next() < 0.5) { tap(it.tertiary, ms); ai.postPlan = 'done'; return; }   // CROSS in the post = drop step
    stickRim(p, 1, 1);
    pressButton(it.primary, ms); ai.pumpOn = false; ai.postPlan = 'done';
    return;
  }
  if (ai.postPlan === 'pump') {
    pressButton(it.primary, ms); ai.pumpOn = true; ai.pumpCd = PUMP_TAP; ai.pumpDone = true; ai.upUnder = upUnderRoll(p, world, d); ai.postPlan = 'done';
    return;
  }
  // the post shot: stick neutral (Giannis: lateral for the hook)
  if (p.id === 'giannis' && rng.next() < 0.5) stickRel(p, p.pos.x >= 0 ? -0.6 : 0.6, 0);
  pressButton(it.primary, ms); ai.pumpOn = false; ai.postPlan = 'done';
}

// ------------------------------------------------------------------------------------------------ off-ball offence

function offBall(p, ai, world, tick, ms, S) {
  const ball = world.ball, it = p.intent;
  it.post = false; it.plain = false;
  if (it.primary.held) releaseButton(it.primary, ms);
  if (reboundPlay(p, ai, world, S, ms)) return;
  if (ball.state === 'pass' && ball.passInfo.receiver === p) {
    if (S.landValid && ball.pos.y > PASS_Y) steerTo(p, S.landX, S.landZ, false); else steerTo(p, clamp(ball.pos.x, -CLAMP_X, CLAMP_X), clamp(ball.pos.z, CLAMP_Z_MIN, CLAMP_Z_MAX), false);
    return;
  }
  const h = ball.owner && ball.owner.team === p.team ? ball.owner : null;
  if (p.cutting) {
    if (ai.cutT <= 0 || !h) { p.cutting = false; ai.spot = null; ai.cutCd = world.rng.range(CUT_MIN, CUT_MAX); } else { steerTo(p, ai.cutX, ai.cutZ, ai.backdoor); return; }
  }
  if (!ai.spot || ai.spotCd <= 0) { pickSpot(p, ai, world, h, null); ai.spotCd = SPOT_REFRESH; }
  if (tick && h) {
    dirTo(G, h.pos.x, h.pos.z, RIM.x, RIM.z);
    const toRim = h.vel.x * G.x + h.vel.z * G.z;
    // relocation (v1): the handler drives at my spot → another spot away from his path; Giannis to the dunker spot
    if (toRim > RELOCATE_SPEED) {
      B.x = h.pos.x + h.vel.x * RELOCATE_LOOKAHEAD; B.z = h.pos.z + h.vel.z * RELOCATE_LOOKAHEAD;
      if (p.id === 'giannis') {
        const s = h.pos.x > 0 ? -1 : 1;
        ai.cutX = s * 3.0; ai.cutZ = -13.6; ai.cutT = CUT_T; ai.backdoor = false; p.cutting = true;
        steerTo(p, ai.cutX, ai.cutZ, false);
        return;
      }
      if (ai.spot && distXZ(B.x, B.z, ai.spot.x, ai.spot.z) < RELOCATE_R) pickSpot(p, ai, world, h, B);
    }
    const g = guardOf(p, world);
    const gd = g ? distXZ(g.pos.x, g.pos.z, p.pos.x, p.pos.z) : OPEN_MAX;
    // Jordan back-door when denied within 1.0 m (p 0.5 per tick)
    if (p.id === 'jordan' && g && gd <= BACKDOOR_R && rimD(p) > 4.0 && world.rng.next() < BACKDOOR_P) {
      dirTo(G, p.pos.x, p.pos.z, RIM.x, RIM.z);
      ai.cutX = RIM.x - G.x * CUT_DEPTH; ai.cutZ = RIM.z - G.z * CUT_DEPTH; ai.cutT = CUT_T; ai.backdoor = true; p.cutting = true;
      steerTo(p, ai.cutX, ai.cutZ, true);
      return;
    }
    if (ai.cutCd <= 0) {
      dirTo(G, p.pos.x, p.pos.z, RIM.x, RIM.z);
      const cx = RIM.x - G.x * CUT_DEPTH, cz = RIM.z - G.z * CUT_DEPTH;
      if (gd > CUT_DEF_R && cutLaneOpen(p, world, cx, cz, g)) {
        ai.cutX = cx; ai.cutZ = cz; ai.cutT = CUT_T; ai.backdoor = false; p.cutting = true;
        steerTo(p, cx, cz, false);
        return;
      }
      ai.cutCd = CUT_RETRY;
    }
  }
  if (h && getOpen(p, ai, world, h, tick)) return;
  if (ai.spot) steerTo(p, ai.spot.x, ai.spot.z, false);
}

/**
 * Get open (v-cut / lift): at his spot with the handler's lane to him unsafe (risk > the handler's riskTol), the
 * receiver steps GETOPEN_STEP to the side of, toward or away from the handler, whichever lane is safest now; his
 * defender follows a reaction later, which is the passing window. Held for GETOPEN_T.
 */
function getOpen(p, ai, world, h, tick) {
  if (ai.openCd > 0) { steerTo(p, ai.openX, ai.openZ, false); return true; }
  if (!tick || !ai.spot || h.shot.active || distXZ(p.pos.x, p.pos.z, ai.spot.x, ai.spot.z) > GETOPEN_NEAR) return false;
  const tol = riskTolOf(h, aiDiff(world, h));
  const r0 = passRisk(h, p, p.pos.x, p.pos.z, world);
  if (r0 <= tol) return false;
  dirTo(G, h.pos.x, h.pos.z, p.pos.x, p.pos.z);
  let bestR = r0 - GETOPEN_GAIN, bx = 0, bz = 0, found = false;
  for (let k = 0; k < 4; k++) {
    // k 0/1: sideways ±; k 2: toward the handler; k 3: away (a lift)
    const ox = k < 2 ? -G.z * (k === 0 ? 1 : -1) : G.x * (k === 2 ? -1 : 1);
    const oz = k < 2 ? G.x * (k === 0 ? 1 : -1) : G.z * (k === 2 ? -1 : 1);
    A.x = p.pos.x + ox * GETOPEN_STEP; A.z = p.pos.z + oz * GETOPEN_STEP;
    clampCourt(A);
    if (distXZ(A.x, A.z, h.pos.x, h.pos.z) < SLOT_SEP) continue;
    const r = passRisk(h, p, A.x, A.z, world);
    if (r < bestR) { bestR = r; bx = A.x; bz = A.z; found = true; }
  }
  if (!found) return false;
  ai.openX = bx; ai.openZ = bz; ai.openCd = GETOPEN_T;
  steerTo(p, bx, bz, false);
  return true;
}

function cutLaneOpen(p, world, cx, cz, g) {
  const ps = world.players;
  for (let i = 0; i < ps.length; i++) {
    const o = ps[i];
    if (o.team === p.team || o === g) continue;
    if (segClosest(o.pos.x, o.pos.z, p.pos.x, p.pos.z, cx, cz).d < CUT_LANE_R) return false;
  }
  return true;
}

/**
 * Spot choice (§5.10): maximise w − 0.15·distance over the legend's unowned spots ≥ 2.5 m from the teammates and the
 * handler (and ≥ 3.5 m from `away`, the driving handler's path); fallback: the nearest unowned spot of his list. The
 * current spot is kept unless another beats it by 0.10.
 */
function pickSpot(p, ai, world, h, away) {
  const list = spotList(p.id);
  const ps = world.players;
  let best = null, bestS = -Infinity, cur = -Infinity, near = null, nearD = Infinity;
  for (let i = 0; i < list.length; i++) {
    const s = list[i].slot;
    let owned = false, crowded = false;
    for (let j = 0; j < ps.length; j++) {
      const q = ps[j];
      if (q === p || q.team !== p.team) continue;
      if (q.ai && q.ai.spot === s && q !== h) owned = true;
      if (distXZ(q.pos.x, q.pos.z, s.x, s.z) < SLOT_SEP) crowded = true;
    }
    if (owned) continue;
    const d = distXZ(p.pos.x, p.pos.z, s.x, s.z);
    if (d < nearD) { nearD = d; near = s; }
    if (crowded) continue;
    if (away && distXZ(away.x, away.z, s.x, s.z) < 3.5) continue;
    // receivers prefer spots the handler can reach: − SPOT_RISK_K × the lane risk to the spot as the defence stands
    const sc = list[i].w - SPOT_DIST_K * d - (h && h !== p ? SPOT_RISK_K * passRisk(h, p, s.x, s.z, world) : 0);
    if (s === ai.spot) cur = sc;
    if (sc > bestS) { bestS = sc; best = s; }
  }
  if (best && ai.spot && cur > -Infinity && bestS < cur + SPOT_SWITCH) return;
  ai.spot = best || near || ai.spot || topSpot(p.id);
}

// ------------------------------------------------------------------------------------------------ rebounds and loose balls

/**
 * Shared by both sides (v1 §7 + §5.6): after a shot the crashers (offence: tend.crash roll; defence: within 4.5 m of
 * the rim or boxing) go to the landing point after rebReact; a loose ball is chased within 5 m and by the nearest of
 * each team; rebound jumps when the descending ball is within reach. Returns true when busy with the ball.
 */
function reboundPlay(p, ai, world, S, ms) {
  const ball = world.ball, st = ball.state;
  if (st !== 'flight' && st !== 'loose') return false;
  const shot = ball.ctx === 'shot' || ball.ctx === 'block';
  const dRim = rimD(p), dBall = distXZ(p.pos.x, p.pos.z, ball.pos.x, ball.pos.z);
  const it = p.intent;
  if (st === 'flight' && shot) {
    if (ai.rebCd > 0) return p.team !== world.offense && dRim < REB_RIM_R;   // reacting: hold position
    if (p.team === world.offense) {
      if (ai.crashShot !== S.shotSeen) { ai.crashShot = S.shotSeen; ai.crash = world.rng.next() < tendOf(p).crash; }
      if (!ai.crash) {
        // long rebound: the nearest arc point
        dirTo(G, RIM.x, RIM.z, p.pos.x, p.pos.z);
        A.x = RIM.x + G.x * 6.4; A.z = RIM.z + G.z * 6.4; clampCourt(A);
        steerTo(p, A.x, A.z, false);
        return true;
      }
    } else if (dRim >= REB_RIM_R && !(p.boxT > 0)) return false;
    if (p.boxT > 0 && p.boxing) {
      dirTo(G, p.boxing.pos.x, p.boxing.pos.z, RIM.x, RIM.z);
      steerTo(p, p.boxing.pos.x + G.x * 0.6, p.boxing.pos.z + G.z * 0.6, false);
    } else if (S.landValid && ball.pos.y > LAND_Y) steerTo(p, S.landX, S.landZ, false);
    else { A.x = ball.pos.x; A.z = ball.pos.z; clampCourt(A); steerTo(p, A.x, A.z, false); }
  } else {
    if (!(dBall < LOOSE_R || dRim < REB_RIM_R || nearestOfTeam(p, world, ball))) return false;
    A.x = ball.pos.x; A.z = ball.pos.z; clampCourt(A);
    if (S.landValid && ball.pos.y > LAND_Y) { A.x = S.landX; A.z = S.landZ; }
    steerTo(p, A.x, A.z, dBall > CHASE_SPRINT_D);
  }
  // rebound jump: descending ball within reach (catchTopY .. catchTopY + hJump + 0.25)
  const top = p.attrs.catchTopY;
  if (p.canAct && ball.vel.y < 0 && dBall < p.attrs.catchR + REB_JUMP_ADD && ball.pos.y > top && ball.pos.y < top + p.attrs.hJump + REB_JUMP_TOP
    && !(ball.state === 'flight' && ball.releaseAge < 0.3)) tap(it.primary, ms);
  return true;
}

function nearestOfTeam(p, world, ball) {
  const ps = world.players;
  const myD = distXZ(p.pos.x, p.pos.z, ball.pos.x, ball.pos.z);
  for (let i = 0; i < ps.length; i++) {
    const q = ps[i];
    if (q === p || q.team !== p.team) continue;
    if (distXZ(q.pos.x, q.pos.z, ball.pos.x, ball.pos.z) < myD) return false;
  }
  return true;
}

// ------------------------------------------------------------------------------------------------ shot / pass tracking

/** A new shot release: everyone's rebound reaction countdown (CPU: rebReact; the human reacts immediately). */
function trackShot(S, world) {
  const b = world.ball;
  if (b.state !== 'flight' || b.ctx !== 'shot' || !b.shot.active) return;
  const id = b.shot.releaseTime;
  if (id === S.shotSeen) return;
  S.shotSeen = id; S.shotTeam = b.shot.team;
  const ps = world.players;
  for (let i = 0; i < ps.length; i++) { const q = ps[i]; if (q.ai) q.ai.rebCd = q.attrs.rebReact; }
}

/**
 * A new pass release (§5.10): the receiver's defender closes out (after his reaction) to catch + dir(catch→rim)·
 * closeGap; every CPU defender with dl < reachR jumps the lane with p 0.6 × stealGamble × interceptGamble.
 */
function trackPass(S, world) {
  const b = world.ball;
  if (b.state !== 'pass') return;
  const pi = b.passInfo;
  if (pi.releaseTime === S.passSeen) return;
  S.passSeen = pi.releaseTime;
  const r = pi.receiver, from = pi.from;
  if (!r || !from) return;
  const land = predictLanding(b, PASS_Y, LAND_TMP);
  S.catchX = land ? clamp(land.x, -CLAMP_X, CLAMP_X) : r.pos.x; S.catchZ = land ? clamp(land.z, CLAMP_Z_MIN, CLAMP_Z_MAX) : r.pos.z;
  const tFlight = land ? land.t : pi.flightT;
  const ps = world.players;
  for (let i = 0; i < ps.length; i++) {
    const d = ps[i];
    if (d.team === from.team || !d.ai || userControls(world, d) || d.disabled) continue;
    const diff = aiDiff(world, d), ai = d.ai;
    if (d.defAssign === r) {
      dirTo(G, S.catchX, S.catchZ, RIM.x, RIM.z);
      const cg = closeGapOf(d);
      ai.closeX = S.catchX + G.x * cg; ai.closeZ = S.catchZ + G.z * cg;
      ai.closeDelayCd = diff.reaction; ai.closeCd = diff.reaction + tFlight + CATCH_GATE + 0.3;
      continue;
    }
    const Sg = segClosest(d.pos.x, d.pos.z, b.pos.x, b.pos.z, S.catchX, S.catchZ);
    const intR = d.attrs.catchR + INTERCEPT.R_ADD + (has(d, 'jordan.hawk') ? 0.20 : 0);
    const tb = Sg.t * tFlight;
    const reachR = intR + d.attrs.run * Math.max(0, tb - diff.reaction);
    if (Sg.d < reachR && world.rng.next() < laneGambleP(d, diff)) {
      ai.laneX = b.pos.x + (S.catchX - b.pos.x) * Sg.t; ai.laneZ = b.pos.z + (S.catchZ - b.pos.z) * Sg.t;
      ai.laneCd = tFlight + 0.1; ai.laneDelayCd = diff.reaction;     // he sees the release a reaction later
    }
  }
}

// ------------------------------------------------------------------------------------------------ defence (§5.10)

function defence(p, ai, world, tick, ms, S) {
  const it = p.intent, ball = world.ball;
  it.post = false; it.plain = false;
  if (it.primary.held) releaseButton(it.primary, ms);
  const man = p.defAssign && p.defAssign.team === world.offense ? p.defAssign : nearestOpp(p, world);
  // contest / block jumps (time critical; every step)
  if (contestStep(p, ai, world, ms)) return;
  if (reboundPlay(p, ai, world, S, ms)) return;
  if (!man) { stopMove(it); return; }
  const diff = aiDiff(world, p);
  // lane jump on a pass (sprint to the closest point of the pass line)
  if (ai.laneCd > 0 && ai.laneDelayCd <= 0 && ball.state === 'pass') { steerTo(p, ai.laneX, ai.laneZ, true); return; }
  // closeout on the receiver (R#40): after the reaction, sprint × tend.closeout to catch + dir(catch→rim)·closeGap
  if (ai.closeCd > 0 && (ball.state === 'pass' || ball.owner === man)) {
    if (ai.closeDelayCd > 0) { stopMove(it); return; }
    const cs = closeoutSpeed(p);
    if (ball.owner === man) { dirTo(G, man.pos.x, man.pos.z, RIM.x, RIM.z); ai.closeX = man.pos.x + G.x * closeGapOf(p); ai.closeZ = man.pos.z + G.z * closeGapOf(p); }
    steerTo(p, ai.closeX, ai.closeZ, cs.sprint, cs.mag);
    return;
  }
  const h = ball.owner && ball.owner.team === world.offense ? ball.owner : null;
  // help (v1 rule with §5.10 probabilities) and the post double team
  if (tick && h && h !== man && ai.helpCd <= 0) maybeHelp(p, ai, world, h, diff);
  if (ai.helpCd > 0 && h) {
    dirTo(G, h.pos.x, h.pos.z, RIM.x, RIM.z);
    if (h.state === 'post') { A.x = h.pos.x + G.x * 0.9 - G.z * 0.5; A.z = h.pos.z + G.z * 0.9 + G.x * 0.5; } else { A.x = RIM.x - G.x * HELP_FRONT; A.z = RIM.z - G.z * HELP_FRONT; }
    steerTo(p, A.x, A.z, distXZ(p.pos.x, p.pos.z, A.x, A.z) > HELP_SPRINT_D);
    // the dig: a helper (post double, drive help) who ends up within reach of a dribbling handler swipes at the ball
    // with the same attempt interval and gamble as an on-ball poke, scaled by DIG_K (I3)
    if (tick && ai.stealCd <= 0 && pokeAllowed(p, h, world) && distXZ(p.pos.x, p.pos.z, h.pos.x, h.pos.z) <= stealRangeOf(p)) {
      ai.stealCd = diff.cpuStealInterval;
      if (world.rng.next() < DIG_K * pokeProb(p)) { tap(it.tertiary, ms); ai.pokes++; }
    }
    return;
  }
  if (man === h) onBall(p, ai, world, man, diff, tick, ms);
  else offBallDef(p, ai, world, man, diff, h);
}

/**
 * Perceived position of `man` now: his position `r` seconds ago (the reaction ring) carried forward by the velocity
 * seen then ((x(t−r) − x(t−r−0.1)) / 0.1 × r, at most PERCEIVE_MAX metres). A change of direction (a crossover, a
 * spin) is still seen `r` late; a straight drive is tracked.
 */

function perceive(man, r, out) {
  man.getDelayed(out, r);
  man.getDelayed(B, r + PERCEIVE_DT);
  const vx = (out.x - B.x) / PERCEIVE_DT, vz = (out.z - B.z) / PERCEIVE_DT;
  PV.x = vx; PV.z = vz;
  let dx = vx * r, dz = vz * r;
  const l = Math.sqrt(dx * dx + dz * dz);
  if (l > PERCEIVE_MAX) { dx *= PERCEIVE_MAX / l; dz *= PERCEIVE_MAX / l; }
  out.x += dx; out.z += dz;
  return out;
}

/**
 * Pursuit steering for a moving goal (the on-ball gap point): desired velocity = the goal's perceived velocity +
 * (goal − position) / PURSUIT_TAU, as a stick fraction of the run speed; SPRINT when that exceeds the run speed.
 */
function steerPursuit(p, tx, tz, vx, vz, sprintOK) {
  const it = p.intent, m = it.move;
  let ux = vx + (tx - p.pos.x) / PURSUIT_TAU, uz = vz + (tz - p.pos.z) / PURSUIT_TAU;
  const sp = Math.sqrt(ux * ux + uz * uz);
  const run = p.attrs.run;
  if (sp < STOP_R) { m.x = 0; m.z = 0; m.mag = 0; it.sprint = false; return; }
  ux /= sp; uz /= sp;
  const k = sp >= run ? 1 : sp / run;
  m.x = ux * k; m.z = uz * k; m.mag = k;
  it.sprint = sprintOK && sp > run && p.stamina > SPRINT_MIN_STAMINA;
}

/** On-ball defence: gap (§5.10) from the perceived man; during his shot no backing off (R#29); pokes. */
function onBall(p, ai, world, man, diff, tick, ms) {
  const it = p.intent;
  const s = man.shot;
  if (s.active && !s.launched) { shotSteer(p, man, world); return; }
  perceive(man, diff.reaction, D);
  dirTo(G, D.x, D.z, RIM.x, RIM.z);
  const gap = Math.max(0, Math.min(onBallGap(p, man, diff.defGap), distXZ(D.x, D.z, RIM.x, RIM.z) - GAP_RIM_MARGIN));
  A.x = D.x + G.x * gap; A.z = D.z + G.z * gap;
  // the post: body up on the hip
  if (man.state === 'post') { A.x = man.pos.x + G.x * 0.82; A.z = man.pos.z + G.z * 0.82; }
  // beaten on a drive: recover to the rim side of the finish instead of trailing (LeBron trails for the chase-down)
  else if (man.speed >= HELP_DRIVE_V && headingCos(man) >= COS45 && guardBeaten(man, p) && !has(p, 'lebron.chaseDown')
    && distXZ(D.x, D.z, RIM.x, RIM.z) > RECOVER_D && !spotHeld(p, world, RIM.x - G.x * RECOVER_D, RIM.z - G.z * RECOVER_D)) {
    A.x = RIM.x - G.x * RECOVER_D; A.z = RIM.z - G.z * RECOVER_D;
  }
  clampCourt(A);
  steerPursuit(p, A.x, A.z, PV.x, PV.z, true);
  // poke (CPU attempt interval, R7 graces; tend.stealGamble)
  // no reach-in against a handler attacking at speed or inside a move (a failed poke stuns: the drive would be free)
  // a gamble: within POKE_REACH of his range the defender steps in (≤ POKE_COMMIT s) and pokes once in range
  const range = stealRangeOf(p);
  const dMan = distXZ(p.pos.x, p.pos.z, man.pos.x, man.pos.z);
  const pokeOK = pokeAllowed(p, man, world);
  if (ai.pokeCd > 0 && pokeOK) {
    if (dMan <= range) { tap(it.tertiary, ms); ai.pokes++; ai.pokeCd = 0; } else steerTo(p, man.pos.x, man.pos.z, false);
    return;
  }
  if (tick && ai.stealCd <= 0 && pokeOK && dMan <= range + POKE_REACH) {
    ai.stealCd = diff.cpuStealInterval;
    if (world.rng.next() < pokeProb(p)) {
      if (dMan <= range) { tap(it.tertiary, ms); ai.pokes++; } else ai.pokeCd = POKE_COMMIT;
    }
  }
}


function stealRangeOf(p) { return p.attrs.stealRange + (has(p, 'jordan.hawk') ? STEAL_RANGE_HAWK : 0); }

/** A CPU poke is on: the man dribbles (not inside a move, not attacking at speed), R7 graces, the defender can act. */
function pokeAllowed(p, man, world) {
  return man.dribbling && man.state !== 'cross' && man.speed <= POKE_MAX_V && p.canAct && p.stealCd <= 0
    && world.liveT >= POKE_LIVE && world.time - man.cx.catchT >= POKE_CATCH;
}

function shotSteer(p, sh, world) {
  const it = p.intent;
  dirTo(G, sh.pos.x, sh.pos.z, RIM.x, RIM.z);
  A.x = sh.pos.x + G.x * SHOT_FRONT; A.z = sh.pos.z + G.z * SHOT_FRONT;
  // a teammate already holds the spot in front of the shooter (a rim protector rising): take the shooter's side
  // instead of running through him (the separation pass would shove the airborne blocker off the ball)
  const ps = world.players;
  for (let i = 0; i < ps.length; i++) {
    const q = ps[i];
    if (q === p || q.team !== p.team || q.disabled) continue;
    if (!(q.isJumping || (q.ai && q.ai.jumpShooter === sh) || (rimKind(sh.shot.kind) && RIM_PROTECT[q.id] !== undefined))) continue;
    if (distXZ(q.pos.x, q.pos.z, A.x, A.z) > p.attrs.bodyR + q.attrs.bodyR + SPOT_TAKEN_PAD) continue;
    const side = (q.pos.x - sh.pos.x) * -G.z + (q.pos.z - sh.pos.z) * G.x >= 0 ? -1 : 1;   // away from the teammate
    A.x = sh.pos.x + G.x * SHOT_SIDE_FWD - G.z * side * SHOT_SIDE; A.z = sh.pos.z + G.z * SHOT_SIDE_FWD + G.x * side * SHOT_SIDE;
    break;
  }
  const dsh = distXZ(p.pos.x, p.pos.z, sh.pos.x, sh.pos.z);
  steerTo(p, A.x, A.z, dsh > CLOSE_IN_R);
  const m = it.move;
  dirTo(B, p.pos.x, p.pos.z, sh.pos.x, sh.pos.z);          // toward the shooter
  const along = m.x * B.x + m.z * B.z;
  if (along < 0) { m.x -= along * B.x; m.z -= along * B.z; m.mag = Math.sqrt(m.x * m.x + m.z * m.z); }
  if (dsh <= CLOSE_IN_R) {
    const cap = CONTEST_V / p.attrs.run;
    if (m.mag > cap) { const k = cap / m.mag; m.x *= k; m.z *= k; m.mag = cap; }
    it.sprint = false;
  }
}

/** Off-ball defence: k toward the rim (§5.10) + 0.6 m toward the ball; Yao drops to ≤ 4.5 m unless his man posts. */
function offBallDef(p, ai, world, man, diff, h) {
  const ball = world.ball;
  if (man.shot.active && !man.shot.launched) { shotSteer(p, man, world); return; }
  perceive(man, diff.reaction * helpReactionMul(p), D);
  const k = offBallSag(man);
  A.x = lerp(D.x, RIM.x, k); A.z = lerp(D.z, RIM.z, k);
  dirTo(G, A.x, A.z, ball.pos.x, ball.pos.z);
  A.x += G.x * OFF_TOWARD_BALL; A.z += G.z * OFF_TOWARD_BALL;
  // rim protectors (Yao anchor, Giannis help) keep a foot in the lane: half way to the ball→rim line PROTECT_D from the rim
  if (h && (has(p, 'yao.anchor') || has(p, 'giannis.helpBlock')) && man.state !== 'post') {
    dirTo(B, RIM.x, RIM.z, h.pos.x, h.pos.z);
    A.x += (RIM.x + B.x * PROTECT_D - A.x) * PROTECT_W; A.z += (RIM.z + B.z * PROTECT_D - A.z) * PROTECT_W;
  }
  if (p.id === 'yao' && distXZ(man.pos.x, man.pos.z, RIM.x, RIM.z) > YAO_POST_R) {
    const dr = distXZ(A.x, A.z, RIM.x, RIM.z);
    if (dr > YAO_DROP_R) { const s = YAO_DROP_R / dr; A.x = RIM.x + (A.x - RIM.x) * s; A.z = RIM.z + (A.z - RIM.z) * s; }
  }
  clampCourt(A);
  steerTo(p, A.x, A.z, distXZ(p.pos.x, p.pos.z, A.x, A.z) > 3.0 && !!h && h.sprinting);
}

/**
 * Help (v1 rule, §5.10): the handler within the help radius of the rim with his guard beaten; the nearest CPU off-ball
 * defender rotates with clamp(help × tend.help, 0, 0.95) per tick and commits 1.5 s. Post double team: the handler in
 * the post vs a mismatch, a help defender within 3.5 m doubles once with p 0.5 × help × tend.help.
 */
function maybeHelp(p, ai, world, h, diff) {
  if (userControls(world, p)) return;
  if (h.state === 'post') {
    if (ai.doubleRolled) return;
    ai.doubleRolled = true;
    const g = guardOf(h, world);
    if (!isMismatch(h, g) || distXZ(p.pos.x, p.pos.z, h.pos.x, h.pos.z) > DOUBLE_HELP_R) return;
    if (world.rng.next() < DOUBLE_HELP_K * helpProb(p, diff)) ai.helpCd = HELP_T;
    return;
  }
  // the handler where he will be when the help arrives (help reaction lookahead)
  const protector = has(p, 'yao.anchor') || has(p, 'giannis.helpBlock');
  const look = protector ? HELP_LOOK_PROTECTOR : HELP_LOOK;
  const hx = h.pos.x + h.vel.x * look, hz = h.pos.z + h.vel.z * look;
  if (distXZ(hx, hz, RIM.x, RIM.z) >= helpRadiusOf(p)) return;
  const g = guardOf(h, world);
  // the v1 rule: his guard is beaten; rim protectors (Yao anchor, Giannis help) also step in on any drive at the rim
  const driving = h.speed >= HELP_DRIVE_V && headingCos(h) >= COS45;
  if (!guardBeaten(h, g) && !(protector && driving)) return;
  // the off-ball defender nearest to the help spot (1 m in front of the rim on the drive line) rotates
  dirTo(G, hx, hz, RIM.x, RIM.z);
  const sx = RIM.x - G.x * HELP_FRONT, sz = RIM.z - G.z * HELP_FRONT;
  const myD = distXZ(p.pos.x, p.pos.z, sx, sz);
  const ps = world.players;
  for (let i = 0; i < ps.length; i++) {
    const q = ps[i];
    if (q === p || q.team === h.team || q === g || userControls(world, q)) continue;
    if (distXZ(q.pos.x, q.pos.z, sx, sz) < myD) return;
  }
  if (world.rng.next() >= helpProb(p, diff)) return;
  ai.helpCd = HELP_T;
  // switch on the rotation (I3): the helper keeps the driver and the beaten guard takes the helper's man, so a kick-out
  // finds new matchups (the scramble that makes post mismatches); Yao never switches (§5.10: no Yao on a perimeter
  // player while another assignment exists), and the human's assignment is never changed
  if (p.id !== 'yao' && g && g.id !== 'yao' && g.team === p.team && !userControls(world, g) && p.defAssign && p.defAssign !== h) {
    const m = p.defAssign; p.defAssign = h; g.defAssign = m;
  }
}

/**
 * Contest / block timing (§5.10, R#39): when an opponent's SHOOT press is seen (after the reaction; Giannis help ×
 * 0.5), the defender within 1.6 m (or inside the anchor / help Rc) rolls contestJumpP × tend.contestJump and schedules
 * the jump so its apex lands at tRel + 0.03 (tRel = press + tIdeal; dunks: the rising phase) with N(0, jumpSigma);
 * late by ≤ 0.10 s → now, later → hands up. Rim protectors (Yao, Giannis, LeBron) jump at layups / dunks when the
 * predicted hand–ball distance at their apex is within 0.40 / 0.45 / 0.50 m. Returns true while the jump is
 * pending and the steering was written.
 */
function contestStep(p, ai, world, ms) {
  const ps = world.players;
  let sh = null;
  for (let i = 0; i < ps.length; i++) {
    const o = ps[i];
    if (o.team === p.team || !o.shot.active || o.shot.launched) continue;
    if (!sh || o === p.defAssign) sh = o;
  }
  if (!sh) { ai.jumpOn = false; ai.aimOn = false; ai.jumpShooter = null; return false; }
  const s = sh.shot;
  const diff = aiDiff(world, p);
  // pump fake: the shot was cancelled / replaced → drop the plan
  if (ai.jumpShooter === sh && ai.jumpShotT !== s.pressT) { ai.jumpOn = false; ai.jumpShooter = null; }
  if (ai.seenPress !== s.pressT) {
    const help = p.defAssign !== sh;
    const react = diff.reaction * (help ? helpReactionMul(p) : 1);
    if (world.time - s.pressT >= react) {
      ai.seenPress = s.pressT;
      planJump(p, ai, world, sh, diff, help);
    }
  }
  if (ai.jumpShooter === sh && ai.jumpOn && ai.jumpCd <= 1e-9) {
    ai.jumpOn = false; ai.aimOn = false;
    if (p.canAct) { stopMove(p.intent); tap(p.intent.primary, ms); return true; }
  }
  if (ai.aimOn && ai.jumpShooter === sh && ai.jumpOn) { steerTo(p, ai.aimX, ai.aimZ, distXZ(p.pos.x, p.pos.z, ai.aimX, ai.aimZ) > CLOSE_IN_R); return true; }
  if (p.defAssign === sh || ai.jumpShooter === sh) { shotSteer(p, sh, world); return true; }
  return false;
}

function planJump(p, ai, world, sh, diff, help) {
  const s = sh.shot, rng = world.rng;
  const kind = s.kind;
  const rimShot = kind === 'layup' || kind === 'dunk' || kind === 'floater' || kind === 'hook' || kind === 'tip';
  const dsh = distXZ(p.pos.x, p.pos.z, sh.pos.x, sh.pos.z);
  const tm = s.timing;
  // time of the ball at its block point (s after the press): the release (tIdeal) or the dunk's rising phase
  const tBall = kind === 'dunk' && tm ? (tm.takeoffT + Math.max(0.05, (tm.profile && tm.profile.slam > 0 ? tm.profile.slam : 0.3) - 0.12)) : s.tIdeal;
  DEFJ.intent = dsh <= 2.5 ? 'block' : 'contest'; DEFJ.chase = p.chaseShooter === sh; DEFJ.help = help; DEFJ.hJump = p.attrs.hJump; DEFJ.arm = 'R';
  const sel = selectDefJump(p, DEFJ);
  const to = sel.takeoffT, h = sel.h > 0 ? sel.h : p.attrs.hJump;
  const air = 2 * Math.sqrt(2 * h / 9.81);
  const protector = RIM_PROTECT[p.id];
  if (rimShot && (kind === 'layup' || kind === 'dunk') && protector !== undefined && (p.id !== 'lebron' || DEFJ.chase || help)) {
    // hand–ball prediction at the apex: the ball over the rim side of the shooter at tBall
    dirTo(G, sh.pos.x, sh.pos.z, RIM.x, RIM.z);
    const reachSh = sh.legend.stats.reachM, hSh = tm ? tm.h : 0.6;
    const lead = Math.min(distXZ(sh.pos.x, sh.pos.z, RIM.x, RIM.z) - 0.4, Math.max(0, sh.speed * Math.min(tBall, tm ? tm.takeoffT : 0.3)));
    const bx = sh.pos.x + G.x * (Math.max(0, lead) + SHOT_HAND_FWD), bz = sh.pos.z + G.z * (Math.max(0, lead) + SHOT_HAND_FWD);
    const by = kind === 'dunk' ? SHOT_V2.DUNK_REL_Y : reachSh + SHOT_V2.LAYUP_REL_ADD + hSh;
    const tAvail = Math.max(0, tBall - (world.time - s.pressT) - to - air * 0.5);
    const dd = distXZ(p.pos.x, p.pos.z, bx, bz);
    const run = p.attrs.run * (p.sprinting ? p.attrs.sprintMul : 1);
    const reachH = Math.max(0, dd - run * tAvail - 0.30);    // palm 0.30 m in front of the root
    const hy = p.legend.stats.reachM - 0.24 + h - by;
    if (Math.sqrt(reachH * reachH + hy * hy) <= protector) {
      // take off from where the palm (0.30 m in front of the root) meets the predicted ball
      dirTo(B, p.pos.x, p.pos.z, bx, bz);
      ai.aimX = bx - B.x * BLOCK.HEADLESS_HAND_FWD; ai.aimZ = bz - B.z * BLOCK.HEADLESS_HAND_FWD;
      schedule(p, ai, world, sh, tBall, to, air, diff);
      ai.aimOn = ai.jumpOn;
      return;
    }
    // no clean look at the ball: the generic contest roll below still applies
  }
  const inRange = dsh <= CONTEST_R || (has(p, 'yao.anchor') && rimShot && rimD(p) <= TRIGGERS.YAO_ANCHOR.RIM_R && dsh <= TRIGGERS.YAO_ANCHOR.SHOOTER_R)
    || (help && has(p, 'giannis.helpBlock') && dsh <= TRIGGERS.GIANNIS_HELP_RC);
  if (!inRange || (help && p.defAssign !== sh && ai.helpCd <= 0 && dsh > CONTEST_R)) return;
  if (rng.next() >= diff.contestJumpP * contestJumpTend(p, rimShot)) return;
  schedule(p, ai, world, sh, tBall, to, air, diff);
}

/**
 * Schedule the jump: press at tRel + 0.03 − airtime/2 + N(0, jumpSigma). The clip's takeoff delay `to` is not taken
 * off: the apex lands ≈ `to` after the release, where the ball rising toward the rim passes over a defender in front
 * (I3 measured: taking `to` off cut the band-A block rate from ~3.3 % to ~1.3 %).
 */
function schedule(p, ai, world, sh, tBall, to, air, diff) {
  const tPressAbs = sh.shot.pressT + tBall + JUMP_LEAD - air * 0.5 + world.rng.gauss(0, diff.jumpSigma);
  const wait = tPressAbs - world.time;
  if (wait < -LATE_JUMP) return;                                // too late: hands up
  ai.jumpShooter = sh; ai.jumpShotT = sh.shot.pressT;
  ai.jumpCd = wait > 0 ? wait : 0; ai.jumpOn = true;
}

// ------------------------------------------------------------------------------------------------ matchups

/**
 * Greedy re-match (v1 §7.3): two defenders within 0.8 m of the same attacker for more than 1 s → repeatedly pair the
 * closest (defender, attacker); Yao is charged +2.0 m for an attacker beyond the arc when another assignment exists.
 */
function rematchCheck(world, S, dt) {
  const ps = world.players;
  let crowded = false;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i];
    if (a.team !== world.offense) continue;
    let k = 0;
    for (let j = 0; j < ps.length; j++) {
      const q = ps[j];
      if (q.team !== a.team && distXZ(a.pos.x, a.pos.z, q.pos.x, q.pos.z) < CROWD_R) k++;
    }
    if (k >= 2) crowded = true;
  }
  if (!crowded) { S.crowdT = 0; return; }
  S.crowdT += dt;
  if (S.crowdT <= CROWD_T) return;
  S.crowdT = 0;
  greedyRematch(world);
}

function greedyRematch(world) {
  const ps = world.players;
  let nA = 0, nD = 0;
  for (let i = 0; i < ps.length && i < 8; i++) {
    const p = ps[i];
    if (p.team === world.offense) { if (nA < 3) ATT[nA++] = p; } else if (nD < 3) { DEF[nD++] = p; }
  }
  for (let i = 0; i < 8; i++) TAKEN[i] = 0;
  for (let i = 0; i < nD; i++) DEF[i].defAssign = null;
  const n0 = Math.min(nA, nD);
  for (let k = 0; k < n0; k++) {
    let bi = -1, bj = -1, bd = Infinity;
    for (let i = 0; i < nD; i++) {
      if (DEF[i].defAssign) continue;
      for (let j = 0; j < nA; j++) {
        if (TAKEN[j]) continue;
        let c = distXZ(DEF[i].pos.x, DEF[i].pos.z, ATT[j].pos.x, ATT[j].pos.z);
        if (DEF[i].id === 'yao' && isThree(ATT[j].pos.x, ATT[j].pos.z) && nA > 1) c += YAO_ARC_COST;
        if (c < bd) { bd = c; bi = i; bj = j; }
      }
    }
    if (bi < 0) break;
    DEF[bi].defAssign = ATT[bj]; TAKEN[bj] = 1;
  }
  for (let i = 0; i < 3; i++) { ATT[i] = null; DEF[i] = null; }
}

