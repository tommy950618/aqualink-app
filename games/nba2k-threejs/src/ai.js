// AI (spec section 7, section 5.14 usage, section 14 row 16). Every CPU-driven player is steered by
// writing ONLY into player.intent, the same shape a human produces through input.js, so game.js has one
// code path for shots, passes, steals, crossovers and jumps. Decisions run on a 0.10 s tick staggered
// per player; steering (intent.move / sprint) and the time-critical reactions (meter release, contest
// and rebound jumps) run every step. Reaction delay comes from Player.getDelayed (the 0.5 s position
// ring buffer). Per-player state lives in player.ai (created once); scratch objects are module-level,
// so nothing allocates per step after a player's first update.
import { RIM, SLOTS, SHOT, MOVE, DIFFICULTY, FIXED_DT, isThree } from './constants.js';
import { clamp, lerp } from './math.js';
import { predictLanding } from './physics.js';
import { classifyShot, meterDuration, dunkLaneClear } from './shot.js';
import { clearEdges } from './input.js';

const TICK = 0.10;                          // decision interval (section 7)
const HYSTERESIS = 0.4;                     // a chosen handler action persists this long (7.1)
const URGENT_CLOCK = 3;                     // shot clock below this: SHOOT regardless
const PANIC_CLOCK = 1;                      // shot clock below this: release before the buzzer
const SETUP_T = 0.8;                        // hold and face the rim after CHECK
const PROBE_SCORE = 0.4;                    // baseline utility of PROBE (unspecified): above a contested in-range jumper (0.2 + rating)
const PROBE_STEP = 1.6;                     // lateral probe target distance
const PROBE_R_MIN = 5.6, PROBE_R_MAX = 7.8; // radial band the probing handler stays in
const PROBE_SPACE_R = 2.0;                  // "more space" is measured this far to each side
const PROBE_CROSS_R = 0.9, PROBE_CROSS_P = 0.5;
const DRIVE_LANE_R = 1.3, DRIVE_LANE_LEN = 3, DRIVE_FINISH_D = 1.8, DRIVE_OPEN_D = 1.8, DRIVE_STOP = 0.9;
const DRIVE_BRAKE_D = 3.2, DRIVE_BRAKE_MAG = 0.4;   // ease off before the layup so the no-air-control drift stays short
const RANGE_GOOD = 7.6, RANGE_POOR = 6.2;
const SHOOT_CLOSE_BONUS = 0.5;              // layup range (unspecified): the shot score gets this at d <= 2.2
const SHOOT_SET_T = 0.35, SHOOT_SET_CLEAR = 2.2;   // brake before an uncontested jumper (nobody within 2.2 m)
const DRIVE_COMMIT = 0.25;                  // a drive whose lane stays clear keeps going to the finish
const DRIVE_COMMIT_D = 6.5, DRIVE_COMMIT_NEAR = 1.0;   // inside this distance a started drive is finished as a layup, not a sprinting pull-up
const PASS_MARGIN = 0.6, PASS_SCORE = 0.7, PASS_CUT_BONUS = 0.1, LANE_R = 0.8, LOB_HOLD = 0.32;
const PASS_MAX_D = 9.5;                     // no cross-court skips (a 0.25 m chest arc over 11 m is uncatchable)
const LANE_HARD_R = 0.5, LANE_HARD_PER_M = 0.1;   // sure interception radius: 0.5 m + 0.1 m per metre of pass (defenders close in during the flight)
const PASS_HOLD_MIN = 0.5;                  // no pass in the first 0.5 s of holding (stops ping-pong passing)
const RESET_DEF_R = 0.7, RESET_CLOCK = 8, RESET_D = 7.5, RESET_OUT_D = 8.2, RESET_SCORE = 0.65;
const OPEN_MAX = 6;                         // openness with nobody in front (keeps the pass scores finite)
const SLOT_SEP = 2.5;                       // slots keep this far from the handler and the teammates
const RELOCATE_R = 3.0, RELOCATE_LOOKAHEAD = 1.0, RELOCATE_AWAY = 3.5, RELOCATE_SPEED = 2.0;
const CUT_MIN = 4, CUT_MAX = 7, CUT_T = 1.4, CUT_DEF_R = 1.6, CUT_DEPTH = 1.2, CUT_LANE_R = 0.6, CUT_RETRY = 1.0;
const REB_RIM_R = 4.5, REB_JUMP_R = 1.0, REB_JUMP_Y_MAX = 3.2, REB_JUMP_Y_MIN = 2.2, REB_FLIGHT_Y = 2.9;
const LOOSE_R = 5, CHASE_SPRINT_D = 3, LAND_Y = 1.8, LAND_REFRESH = 0.1;
const CONTEST_R = 1.6, HELP_RIM_R = 3.2, HELP_T = 1.5, HELP_FRONT = 1.0, HELP_SPRINT_D = 2.5;
const OFF_LERP_ARC = 0.35, OFF_LERP_IN = 0.20, OFF_TOWARD_BALL = 0.6, GAP_RIM_MARGIN = 0.3;
const CROWD_R = 0.8, CROWD_T = 1.0;         // greedy re-match trigger (7.3)
const TEAMMATE_PASS_T = 0.4;                // the human's CPU teammate passes back after this (< 0.6 s)
const ARRIVE_R = 1.0, STOP_R = 0.06, SPRINT_MIN_D = 1.0, SPRINT_MIN_STAMINA = 0.15;
const CLAMP_X = 7.2, CLAMP_Z_MIN = -14.0, CLAMP_Z_MAX = -0.5;   // steering targets stay inside the AI clamp
const E_MIN = -0.5, E_MAX = 0.45;           // CPU timing error bounds (f stays inside [0.30, 1.25])

const A = { x: 0, z: 0 }, B = { x: 0, z: 0 }, D = { x: 0, z: 0 }, G = { x: 0, z: 0 };
const LAND = { x: 0, z: 0, t: 0, valid: false, at: -1e9, ball: null };
const LAND_TMP = { x: 0, z: 0, t: 0 };
const PASS_OUT = { player: null, score: 0, lob: false };
const ATT = new Array(8).fill(null), DEF = new Array(8).fill(null);
const TAKEN = new Uint8Array(8);

function makeAiState() {
  return {
    active: false, nextTick: -1e9, lastState: '', liveStart: -1e9, offense: -1,
    action: 'probe', actionT: -1e9, sprint: false, probeDir: 0, probeFlipT: -1e9, passTo: null,
    hadBall: false, holdSince: -1e9,
    shooting: false, releaseAt: -1e9, holdT: 0,
    passHold: false, passReleaseAt: -1e9,
    cutAt: -1e9, cutUntil: -1e9, cutX: 0, cutZ: 0,
    helpUntil: -1e9, contestAt: -1, stealAt: -1e9, crowdT: 0,
  };
}

// ---------------------------------------------------------------- small helpers

function rimOf(world) { return world.rimXZ || RIM; }
function slotsOf(world) { return world.slots || SLOTS; }
function difficultyOf(world) {
  const d = world.difficulty;
  return typeof d === 'string' ? (DIFFICULTY[d] || DIFFICULTY.normal) : (d || DIFFICULTY.normal);
}
function distXZ(ax, az, bx, bz) { const dx = bx - ax, dz = bz - az; return Math.sqrt(dx * dx + dz * dz); }
function userTeam(world) {
  if (typeof world.user === 'number') return world.user;
  return world.userPlayer ? world.userPlayer.team : -1;
}
function userControls(world, p) {
  if (world.auto) return false;
  if (typeof world.isUserControlled === 'function') return !!world.isUserControlled(p);
  return p === world.controlled;
}
function isFreeBall(ball) { return ball.state === 'flight' || ball.state === 'loose'; }

// The attacker holding the ball, or null while the ball is free / in a pass.
function ballHandler(world) {
  const b = world.ball;
  if (b.state !== 'held' && b.state !== 'dribble') return null;
  const o = b.owner;
  return o && o.team === world.offense ? o : null;
}

// Unit vector from (fx, fz) to (tx, tz) into out (defaults to -Z when degenerate).
function dirTo(out, fx, fz, tx, tz) {
  const dx = tx - fx, dz = tz - fz;
  const l = Math.sqrt(dx * dx + dz * dz);
  if (l > 1e-6) { out.x = dx / l; out.z = dz / l; } else { out.x = 0; out.z = -1; }
  return out;
}

function clampCourt(out) {
  out.x = clamp(out.x, -CLAMP_X, CLAMP_X);
  out.z = clamp(out.z, CLAMP_Z_MIN, CLAMP_Z_MAX);
  return out;
}

// Planar distance from (px, pz) to the segment a -> b.
function segmentDist(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const len2 = abx * abx + abz * abz;
  const t = len2 > 1e-9 ? clamp(((px - ax) * abx + (pz - az) * abz) / len2, 0, 1) : 0;
  const cx = ax + abx * t - px, cz = az + abz * t - pz;
  return Math.sqrt(cx * cx + cz * cz);
}

// True when an opponent of `team` (other than skipA/skipB) stands within r of the segment a -> b.
function segmentBlocked(ax, az, bx, bz, team, world, r, skipA, skipB) {
  const ps = world.players;
  for (let i = 0; i < ps.length; i++) {
    const o = ps[i];
    if (o === skipA || o === skipB || o.team === team) continue;
    if (segmentDist(o.pos.x, o.pos.z, ax, az, bx, bz) < r) return true;
  }
  return false;
}

// Nearest opponent of p in any direction; writes the distance into nearestOpponent.d.
function nearestOpponent(p, world) {
  const ps = world.players;
  let best = null, bestD = Infinity;
  for (let i = 0; i < ps.length; i++) {
    const o = ps[i];
    if (o === p || o.team === p.team) continue;
    const d = distXZ(p.pos.x, p.pos.z, o.pos.x, o.pos.z);
    if (d < bestD) { bestD = d; best = o; }
  }
  nearestOpponent.d = bestD;
  return best;
}
nearestOpponent.d = Infinity;

// The defender assigned to `attacker` (null when nobody guards him).
function guardOf(attacker, world) {
  const ps = world.players;
  for (let i = 0; i < ps.length; i++) {
    const q = ps[i];
    if (q.team !== attacker.team && q.defAssign === attacker) return q;
  }
  return null;
}

// Valid man assignment of a defender: defAssign when it is an attacker on the offence, else the nearest.
function manOf(p, world) {
  const m = p.defAssign;
  if (m && m !== p && m.team === world.offense) return m;
  return nearestOpponent(p, world);
}

function nearestToBall(players, ball) {
  let best = null, bestD = Infinity;
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const d = distXZ(p.pos.x, p.pos.z, ball.pos.x, ball.pos.z);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

// Intent buttons: CPU timestamps are world.time in milliseconds, so game.js can evaluate the meter as
// (releaseTs - pressTs) / 1000 exactly like a human press.
function pressBtn(b, ms) {
  if (b.held) return false;
  b.held = true; b.justPressed = true; b.pressTs = ms; b.heldTime = 0;
  return true;
}
function releaseBtn(b, ms) {
  if (!b.held) return false;
  b.held = false; b.justReleased = true; b.releaseTs = ms;
  b.heldTime = Math.max(0, (ms - b.pressTs) / 1000);
  return true;
}
function tapBtn(b, ms) { pressBtn(b, ms); releaseBtn(b, ms); }
function updateHeld(b, ms) { b.heldTime = b.held ? Math.max(0, (ms - b.pressTs) / 1000) : 0; }
function stopMove(it) { it.move.x = 0; it.move.z = 0; it.move.mag = 0; it.sprint = false; }
// Drop everything without edges (used outside LIVE and when a player changes hands).
function silence(it) {
  stopMove(it);
  it.primary.held = false; it.primary.heldTime = 0;
  it.secondary.held = false; it.secondary.heldTime = 0;
  it.tertiary.held = false; it.tertiary.heldTime = 0;
  clearEdges(it);
}

function newPossession(p, ai) {
  p.slot = -1;
  p.cutting = false;
  ai.action = 'probe';
  ai.actionT = -1e9;
  ai.helpUntil = -1e9;
  ai.contestAt = -1;
  ai.crowdT = 0;
  ai.probeDir = 0;
}

// Section 5.14: the free ball's landing point at 1.8 m, refreshed every 0.1 s and shared by everyone.
function refreshLanding(world, ball) {
  const t = world.time;
  if (!isFreeBall(ball) && ball.state !== 'pass') { LAND.valid = false; LAND.at = -1e9; LAND.ball = ball; return; }
  if (LAND.ball === ball && t >= LAND.at && t - LAND.at < LAND_REFRESH) return;
  LAND.ball = ball; LAND.at = t;
  const r = predictLanding(ball, LAND_Y, LAND_TMP);
  if (r) {
    LAND.x = clamp(r.x, -CLAMP_X, CLAMP_X); LAND.z = clamp(r.z, CLAMP_Z_MIN, CLAMP_Z_MAX); LAND.t = r.t;
    LAND.valid = true;
  } else {
    LAND.valid = false;
  }
}

// ---------------------------------------------------------------- exported queries

// Distance to the nearest opponent in front of p (dot with the p -> rim direction > 0.3); OPEN_MAX when
// nobody is in front. Section 7.1.
export function openness(p, world) {
  const rim = rimOf(world);
  dirTo(G, p.pos.x, p.pos.z, rim.x, rim.z);
  const ps = world.players;
  let best = OPEN_MAX;
  for (let i = 0; i < ps.length; i++) {
    const o = ps[i];
    if (o === p || o.team === p.team) continue;
    const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z;
    const dd = Math.sqrt(dx * dx + dz * dz);
    if (dd < 1e-6) return 0;
    if ((dx * G.x + dz * G.z) / dd > SHOT.CONTEST_DOT && dd < best) best = dd;
  }
  return best;
}

// True when an opponent of a stands within 0.8 m of the pass line a -> b (floor height).
export function laneBlocked(a, b, world) {
  return segmentBlocked(a.pos.x, a.pos.z, b.pos.x, b.pos.z, a.team, world, LANE_R, a, b);
}

// Section 7.1 PASS scoring: score_t = 1.2*openness_t + 0.5 if cutting - 0.6 if the lane is blocked
// - 0.08*distance. Returns the best teammate (null if none) and writes {player, score, lob} into out.
export function bestPassTarget(handler, world, out = PASS_OUT) {
  out.player = null; out.score = -Infinity; out.lob = false;
  const ps = world.players;
  for (let i = 0; i < ps.length; i++) {
    const q = ps[i];
    if (q === handler || q.team !== handler.team) continue;
    if (q.state === 'stunned' || q.state === 'dunk') continue;
    const d = distXZ(handler.pos.x, handler.pos.z, q.pos.x, q.pos.z);
    if (d > PASS_MAX_D) continue;
    if (segmentBlocked(handler.pos.x, handler.pos.z, q.pos.x, q.pos.z, handler.team, world, LANE_HARD_R + LANE_HARD_PER_M * d, handler, q)) continue;
    const open = openness(q, world);
    const blocked = laneBlocked(handler, q, world);
    const score = 1.2 * open + (q.cutting ? 0.5 : 0) - (blocked ? 0.6 : 0) - 0.08 * d;
    if (score > out.score) { out.score = score; out.player = q; out.lob = !!q.cutting && blocked; }
  }
  return out.player;
}

// Write intent.move toward (x, z): full run speed beyond 1 m, easing in (mag = d / 1 m) to arrive
// without overshoot, dead-stop inside 6 cm. Sprint only when asked and the goal is still > 1 m away.
// Returns the remaining distance.
export function steerTo(player, x, z, sprint) {
  const it = player.intent, m = it.move;
  const dx = x - player.pos.x, dz = z - player.pos.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < STOP_R) {
    m.x = 0; m.z = 0; m.mag = 0;
  } else {
    const mag = d < ARRIVE_R ? d / ARRIVE_R : 1;
    m.x = dx / d * mag; m.z = dz / d * mag; m.mag = mag;
  }
  it.sprint = !!sprint && d > SPRINT_MIN_D && player.stamina > SPRINT_MIN_STAMINA;
  return d;
}

// Nearest slot not owned by a teammate, outside the handler's zone, >= 2.5 m from every teammate and
// (optionally) >= 3.5 m from `awayFrom` ({x,z}, the driving handler's path). Falls back to the nearest
// unowned slot, then the nearest slot. Returns the slot index; the caller stores it in player.slot.
export function pickSlot(player, world, awayFrom) {
  const slots = slotsOf(world);
  const ps = world.players;
  const handler = ballHandler(world);
  let best = -1, bestD = Infinity, freeBest = -1, freeD = Infinity, anyBest = -1, anyD = Infinity;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const d = distXZ(player.pos.x, player.pos.z, s.x, s.z);
    if (d < anyD) { anyD = d; anyBest = i; }
    let owned = false, crowded = false;
    for (let j = 0; j < ps.length; j++) {
      const q = ps[j];
      if (q === player || q.team !== player.team) continue;
      if (q.slot === i && q !== handler) owned = true;
      if (q !== handler && distXZ(q.pos.x, q.pos.z, s.x, s.z) < SLOT_SEP) crowded = true;
    }
    if (owned) continue;
    if (d < freeD) { freeD = d; freeBest = i; }
    if (crowded) continue;
    if (handler && distXZ(handler.pos.x, handler.pos.z, s.x, s.z) < SLOT_SEP) continue;
    if (awayFrom && distXZ(awayFrom.x, awayFrom.z, s.x, s.z) < RELOCATE_AWAY) continue;
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best >= 0) return best;
  return freeBest >= 0 ? freeBest : anyBest;
}

// Section 7.3 assignment. greedy = false: match by roster index (guard <-> guard ...); greedy = true:
// repeatedly pair the closest unmatched (defender, attacker). Extra defenders take the nearest attacker.
// Writes defender.defAssign for every defender (human included) and returns the defender assigned to
// the current ball handler (or to the attacker with roster index 0 when nobody holds the ball).
export function assignDefense(world, greedy = false) {
  const ps = world.players, off = world.offense;
  let nA = 0, nD = 0;
  for (let i = 0; i < ps.length && i < 8; i++) {
    const p = ps[i];
    if (p.team === off) ATT[nA++] = p; else { DEF[nD++] = p; p.defAssign = null; }
  }
  for (let i = 0; i < 8; i++) TAKEN[i] = 0;
  if (!greedy) {
    for (let i = 0; i < nD; i++) {
      const d = DEF[i];
      for (let j = 0; j < nA; j++) if (!TAKEN[j] && ATT[j].index === d.index) { d.defAssign = ATT[j]; TAKEN[j] = 1; break; }
    }
  }
  const n = Math.min(nA, nD);
  for (let k = 0; k < n; k++) {
    let bi = -1, bj = -1, bd = Infinity;
    for (let i = 0; i < nD; i++) {
      if (DEF[i].defAssign) continue;
      for (let j = 0; j < nA; j++) {
        if (TAKEN[j]) continue;
        const d = distXZ(DEF[i].pos.x, DEF[i].pos.z, ATT[j].pos.x, ATT[j].pos.z);
        if (d < bd) { bd = d; bi = i; bj = j; }
      }
    }
    if (bi < 0) break;
    DEF[bi].defAssign = ATT[bj]; TAKEN[bj] = 1;
  }
  for (let i = 0; i < nD; i++) {
    const d = DEF[i];
    if (d.defAssign || nA === 0) continue;
    let bj = 0, bd = Infinity;
    for (let j = 0; j < nA; j++) {
      const dd = distXZ(d.pos.x, d.pos.z, ATT[j].pos.x, ATT[j].pos.z);
      if (dd < bd) { bd = dd; bj = j; }
    }
    d.defAssign = ATT[bj];
  }
  const handler = ballHandler(world);
  let target = handler;
  if (!target) for (let j = 0; j < nA; j++) if (ATT[j].index === 0) target = ATT[j];
  let result = null;
  for (let i = 0; i < nD; i++) if (DEF[i].defAssign === target) { result = DEF[i]; break; }
  for (let i = 0; i < 8; i++) { ATT[i] = null; DEF[i] = null; }
  return result;
}

// ---------------------------------------------------------------- main loop

export function updateAI(world, dt) {
  const ps = world.players, ball = world.ball;
  if (!ps || !ball) return;
  const t = world.time;
  const live = world.state === 'LIVE';
  refreshLanding(world, ball);
  const nearest = live && isFreeBall(ball) ? nearestToBall(ps, ball) : null;
  if (live) {
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.team === world.offense) continue;
      const m = p.defAssign;
      if (!m || m.team !== world.offense) { assignDefense(world, false); break; }
    }
  }
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    let ai = p.ai;
    if (!ai) ai = p.ai = makeAiState();
    if (userControls(world, p)) { ai.active = false; continue; }
    const it = p.intent;
    if (!ai.active) {
      ai.active = true;
      silence(it);
      ai.nextTick = t + i * FIXED_DT;
      ai.hadBall = false; ai.shooting = false; ai.passHold = false;
    }
    clearEdges(it);
    if (world.state !== ai.lastState) {
      ai.lastState = world.state;
      if (live) { ai.liveStart = t; ai.offense = world.offense; newPossession(p, ai); }
    }
    if (ai.offense !== world.offense) { ai.offense = world.offense; newPossession(p, ai); }
    if (!live) { silence(it); ai.hadBall = false; ai.shooting = false; ai.passHold = false; continue; }
    if (t < ai.nextTick - 2 * TICK) ai.nextTick = t + i * FIXED_DT;   // sim clock restarted
    let tick = false;
    if (t >= ai.nextTick) {
      tick = true;
      ai.nextTick += TICK;
      if (t >= ai.nextTick) ai.nextTick = t + TICK;
    }
    const ms = t * 1000;
    updateHeld(it.primary, ms); updateHeld(it.secondary, ms); updateHeld(it.tertiary, ms);
    if (p.team === world.offense) {
      if (p.hasBall) {
        handler(p, ai, world, tick);
      } else {
        if (ai.hadBall) { ai.hadBall = false; ai.shooting = false; ai.passHold = false; silence(it); }
        offBall(p, ai, world, tick, nearest);
      }
    } else {
      if (ai.hadBall) { ai.hadBall = false; ai.shooting = false; ai.passHold = false; silence(it); }
      defence(p, ai, world, tick, nearest);
    }
  }
  if (live) rematchCheck(world, dt);
}

// Section 7.3: two defenders within 0.8 m of the same attacker for more than 1 s -> greedy re-match.
function rematchCheck(world, dt) {
  const ps = world.players;
  let rematch = false;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i];
    if (a.team !== world.offense || !a.ai) continue;
    let near = 0;
    for (let j = 0; j < ps.length; j++) {
      const q = ps[j];
      if (q.team === a.team) continue;
      if (distXZ(a.pos.x, a.pos.z, q.pos.x, q.pos.z) < CROWD_R) near++;
    }
    if (near >= 2) { a.ai.crowdT += dt; if (a.ai.crowdT > CROWD_T) rematch = true; } else a.ai.crowdT = 0;
  }
  if (!rematch) return;
  assignDefense(world, true);
  for (let i = 0; i < ps.length; i++) if (ps[i].ai) ps[i].ai.crowdT = 0;
}

// ---------------------------------------------------------------- offence: the ball handler (7.1)

function handler(p, ai, world, tick) {
  const it = p.intent, t = world.time, ms = t * 1000;
  const rim = rimOf(world), diff = difficultyOf(world), rng = world.rng;
  if (!ai.hadBall) {
    ai.hadBall = true; ai.holdSince = t;
    ai.action = 'probe'; ai.actionT = -1e9; ai.shooting = false; ai.passHold = false; ai.passTo = null;
    p.slot = -1; p.cutting = false; p.passTarget = null;
  }
  stopMove(it);
  if (ai.shooting) {
    // Hold the meter for (0.80 + e) * METER_T, then release with the exact intended timestamp.
    if (it.primary.held) { if (t >= ai.releaseAt) releaseBtn(it.primary, it.primary.pressTs + ai.holdT * 1000); }
    else ai.shooting = false;
    return;
  }
  if (ai.passHold) {
    if (t >= ai.passReleaseAt) { releaseBtn(it.secondary, ms); ai.passHold = false; }
    return;
  }
  if (!p.canAct) return;                     // airborne, stunned or mid-crossover: nothing to decide
  const shotClock = world.shotClock;
  const urgent = shotClock < URGENT_CLOCK;
  if (isUsersTeammate(p, world)) {           // section 7.2: give the ball back to the user's player
    if (urgent) startShot(p, ai, world);
    else if (t - ai.holdSince >= TEAMMATE_PASS_T) startPass(p, ai, world, world.userPlayer);
    return;
  }
  const d = distXZ(p.pos.x, p.pos.z, rim.x, rim.z);
  const defender = nearestOpponent(p, world);
  const defD = nearestOpponent.d;

  if (tick && (urgent || t - ai.actionT >= HYSTERESIS)) {
    let best = 'probe', bestScore = PROBE_SCORE;
    if (urgent) {
      best = 'shoot';
    } else if (t - ai.liveStart < SETUP_T) {
      best = 'setup';
    } else {
      const open = openness(p, world);
      dirTo(G, p.pos.x, p.pos.z, rim.x, rim.z);
      const len = Math.min(DRIVE_LANE_LEN, d);
      const laneClear = !segmentBlocked(p.pos.x, p.pos.z, p.pos.x + G.x * len, p.pos.z + G.z * len, p.team, world, DRIVE_LANE_R, p, null);
      let s = laneClear ? 0.6 + 0.05 * (d - 2) : 0;
      if (defD > DRIVE_OPEN_D) s += 0.2;
      if (laneClear && ai.action === 'drive') s += DRIVE_COMMIT;
      if (ai.action === 'drive' && d < DRIVE_COMMIT_D) s += DRIVE_COMMIT_NEAR;
      if (s > bestScore) { best = 'drive'; bestScore = s; }
      const shooting = p.data && typeof p.data.shooting === 'number' ? p.data.shooting : 1;
      const range = shooting >= 1 ? RANGE_GOOD : RANGE_POOR;
      s = (open >= diff.shootOpen ? 0.5 : 0) + (d <= range ? 0.2 : -0.5) + (shotClock < 6 ? 0.3 : 0) + 0.15 * (shooting - 1) * 10;
      if (d <= SHOT.LAYUP_D) s += SHOOT_CLOSE_BONUS;
      if (s > bestScore) { best = 'shoot'; bestScore = s; }
      const recv = t - ai.holdSince >= PASS_HOLD_MIN ? bestPassTarget(p, world, PASS_OUT) : null;
      if (recv && PASS_OUT.score > open + PASS_MARGIN) {
        s = PASS_SCORE + (recv.cutting ? PASS_CUT_BONUS : 0);
        if (s > bestScore) { best = 'pass'; bestScore = s; ai.passTo = recv; }
      }
      if (defD < RESET_DEF_R && shotClock > RESET_CLOCK && RESET_SCORE > bestScore) { best = 'reset'; bestScore = RESET_SCORE; }
    }
    if (best !== ai.action) {
      ai.action = best; ai.actionT = t;
      ai.sprint = best === 'drive' && rng.next() < diff.sprintProb;
    }
  }

  switch (ai.action) {
    case 'setup':
      break;                                 // stand still; Player faces the rim on its own
    case 'drive': {
      dirTo(G, p.pos.x, p.pos.z, rim.x, rim.z);
      A.x = rim.x - G.x * DRIVE_STOP; A.z = rim.z - G.z * DRIVE_STOP;
      // Keep sprinting into the finish only when it will be a dunk (scripted, no drift); otherwise
      // brake so the layup is released in front of the rim, not behind the board.
      const dunkBound = ai.sprint && p.data && p.data.dunk >= SHOT.DUNK_MIN && dunkLaneClear(p, world);
      steerTo(p, A.x, A.z, ai.sprint && (d >= DRIVE_BRAKE_D || dunkBound));
      if (d < DRIVE_BRAKE_D && !dunkBound) { const m = it.move; m.x *= DRIVE_BRAKE_MAG; m.z *= DRIVE_BRAKE_MAG; m.mag = DRIVE_BRAKE_MAG; }
      // Shake a defender sitting on the drive (same 0.9 m / 0.5 crossover roll as PROBE) before finishing.
      if (tick && d > DRIVE_FINISH_D && defender && defD < PROBE_CROSS_R && p.crossCd <= 0 && rng.next() < PROBE_CROSS_P) tapBtn(it.tertiary, ms);
      else if (d <= DRIVE_FINISH_D) startShot(p, ai, world);
      break;
    }
    case 'shoot':
      // Set the feet first when nobody can contest: a release above 2.5 m/s costs the section 4.3
      // move penalty, but waiting with a defender closing in invites the section 4.7 block.
      if (p.speed > SHOT.MOVE_SPEED && t - ai.actionT < SHOOT_SET_T && d > SHOT.LAYUP_D && defD > SHOOT_SET_CLEAR) break;
      startShot(p, ai, world);
      break;
    case 'pass':
      startPass(p, ai, world, ai.passTo);
      ai.action = 'probe'; ai.actionT = t;
      break;
    case 'reset':
      if (d >= RESET_D) { ai.action = 'probe'; ai.actionT = t; probe(p, ai, world, tick, defender, defD, d); break; }
      dirTo(G, p.pos.x, p.pos.z, rim.x, rim.z);
      A.x = rim.x - G.x * RESET_OUT_D; A.z = rim.z - G.z * RESET_OUT_D;
      clampCourt(A);
      if (distXZ(A.x, A.z, p.pos.x, p.pos.z) < STOP_R * 5) { const top = slotsOf(world)[0]; A.x = top.x; A.z = top.z; }
      steerTo(p, A.x, A.z, false);
      break;
    default:
      probe(p, ai, world, tick, defender, defD, d);
  }
}

// PROBE: dribble laterally along the arc toward the side with more space; crossover under pressure.
function probe(p, ai, world, tick, defender, defD, d) {
  const it = p.intent, t = world.time, rim = rimOf(world);
  dirTo(G, p.pos.x, p.pos.z, rim.x, rim.z);
  const sx = -G.z, sz = G.x;                 // tangent of the arc
  if (tick || ai.probeDir === 0) {
    const spaceR = sideSpace(p, world, sx, sz, 1), spaceL = sideSpace(p, world, sx, sz, -1);
    if (ai.probeDir === 0) ai.probeDir = spaceR >= spaceL ? 1 : -1;
    else if (t >= ai.probeFlipT) {
      const cur = ai.probeDir > 0 ? spaceR : spaceL, other = ai.probeDir > 0 ? spaceL : spaceR;
      if (cur < 1.0 && other > cur + 0.5) { ai.probeDir = -ai.probeDir; ai.probeFlipT = t + HYSTERESIS; }
    }
    if (defender && defD < PROBE_CROSS_R && p.crossCd <= 0 && world.rng.next() < PROBE_CROSS_P) tapBtn(it.tertiary, t * 1000);
  }
  A.x = p.pos.x + sx * ai.probeDir * PROBE_STEP; A.z = p.pos.z + sz * ai.probeDir * PROBE_STEP;
  if (d < PROBE_R_MIN) { A.x -= G.x * (PROBE_R_MIN - d); A.z -= G.z * (PROBE_R_MIN - d); }
  else if (d > PROBE_R_MAX) { A.x += G.x * (d - PROBE_R_MAX); A.z += G.z * (d - PROBE_R_MAX); }
  clampCourt(A);
  if (distXZ(A.x, A.z, p.pos.x, p.pos.z) < 0.4 && t >= ai.probeFlipT) {
    // Pinned against a sideline / the baseline: turn around.
    ai.probeDir = -ai.probeDir; ai.probeFlipT = t + HYSTERESIS;
    A.x = p.pos.x + sx * ai.probeDir * PROBE_STEP; A.z = p.pos.z + sz * ai.probeDir * PROBE_STEP;
    clampCourt(A);
  }
  steerTo(p, A.x, A.z, false);
}

// Free space on one side of the handler: nearest opponent distance to the point 2 m along +-tangent.
function sideSpace(p, world, sx, sz, sign) {
  const px = p.pos.x + sx * sign * PROBE_SPACE_R, pz = p.pos.z + sz * sign * PROBE_SPACE_R;
  if (Math.abs(px) > CLAMP_X || pz < CLAMP_Z_MIN || pz > CLAMP_Z_MAX) return 0;
  const ps = world.players;
  let best = OPEN_MAX;
  for (let i = 0; i < ps.length; i++) {
    const o = ps[i];
    if (o === p || o.team === p.team) continue;
    const dd = distXZ(px, pz, o.pos.x, o.pos.z);
    if (dd < best) best = dd;
  }
  return best;
}

// Press primary and schedule the release: hold = (0.80 + e) * METER_T with e ~ N(0, cpuSigma); under
// one second on the shot clock the hold is cut so the ball leaves before the buzzer.
function startShot(p, ai, world) {
  if (!p.canAct || !p.hasBall) return false;
  const it = p.intent, t = world.time;
  const diff = difficultyOf(world);
  const kind = classifyShot(p, world);
  const e = clamp(world.rng.gauss(0, diff.cpuSigma), E_MIN, E_MAX);
  let hold = (SHOT.F_IDEAL + e) * meterDuration(kind);
  if (world.shotClock < PANIC_CLOCK) hold = Math.min(hold, Math.max(0.05, world.shotClock - 0.08));
  pressBtn(it.primary, t * 1000);
  ai.shooting = true; ai.holdT = hold; ai.releaseAt = t + hold;
  ai.action = 'shoot'; ai.actionT = t;
  return true;
}

// Tap secondary for a chest pass, or hold it >= 0.30 s for a lob (receiver cutting behind a blocked
// lane). The receiver is published as player.passTarget for game.js.
function startPass(p, ai, world, receiver) {
  if (!receiver || receiver === p || !p.canAct || !p.hasBall) return false;
  const it = p.intent, ms = world.time * 1000;
  p.passTarget = receiver;
  if (receiver.cutting && laneBlocked(p, receiver, world)) {
    pressBtn(it.secondary, ms);
    ai.passHold = true; ai.passReleaseAt = world.time + LOB_HOLD;
  } else {
    tapBtn(it.secondary, ms);
  }
  return true;
}

function isUsersTeammate(p, world) {
  if (world.auto || !world.userPlayer || world.userPlayer === p) return false;
  const ut = userTeam(world);
  return ut === p.team && ut === world.offense;
}

// ---------------------------------------------------------------- offence: off-ball (7.2)

function offBall(p, ai, world, tick, nearest) {
  const ball = world.ball, t = world.time, rng = world.rng;
  if (rebound(p, ai, world, nearest)) return;
  if (ball.state === 'pass' && ball.passInfo && ball.passInfo.receiver === p) {
    // Meet the pass where it comes down to chest height.
    if (LAND.valid && ball.pos.y > LAND_Y) steerTo(p, LAND.x, LAND.z, false);
    else steerTo(p, clamp(ball.pos.x, -CLAMP_X, CLAMP_X), clamp(ball.pos.z, CLAMP_Z_MIN, CLAMP_Z_MAX), false);
    return;
  }
  const handler = ballHandler(world);
  const slots = slotsOf(world);
  if (p.slot < 0 || p.slot >= slots.length) { p.slot = pickSlot(p, world); ai.cutAt = t + rng.range(CUT_MIN, CUT_MAX); }
  if (p.cutting) {
    if (t >= ai.cutUntil || !handler) {
      p.cutting = false;
      p.slot = pickSlot(p, world);
      ai.cutAt = t + rng.range(CUT_MIN, CUT_MAX);
    } else {
      steerTo(p, ai.cutX, ai.cutZ, false);
      return;
    }
  }
  if (tick && handler) {
    const rim = rimOf(world);
    // RELOCATE: the handler drives toward my slot -> take the next slot away from his path.
    dirTo(G, handler.pos.x, handler.pos.z, rim.x, rim.z);
    const toRim = handler.vel.x * G.x + handler.vel.z * G.z;
    if (toRim > RELOCATE_SPEED) {
      B.x = handler.pos.x + handler.vel.x * RELOCATE_LOOKAHEAD; B.z = handler.pos.z + handler.vel.z * RELOCATE_LOOKAHEAD;
      const s = slots[p.slot];
      if (distXZ(B.x, B.z, s.x, s.z) < RELOCATE_R) p.slot = pickSlot(p, world, B);
    }
    // CUT toward RIM - fwd*1.2 when my defender is far and the lane is empty.
    if (t >= ai.cutAt) {
      const g = guardOf(p, world);
      const gd = g ? distXZ(g.pos.x, g.pos.z, p.pos.x, p.pos.z) : OPEN_MAX;
      dirTo(G, p.pos.x, p.pos.z, rim.x, rim.z);
      const cx = rim.x - G.x * CUT_DEPTH, cz = rim.z - G.z * CUT_DEPTH;
      if (gd > CUT_DEF_R && !segmentBlocked(p.pos.x, p.pos.z, cx, cz, p.team, world, CUT_LANE_R, p, g)) {
        p.cutting = true; ai.cutUntil = t + CUT_T; ai.cutX = cx; ai.cutZ = cz;
        steerTo(p, cx, cz, false);
        return;
      }
      ai.cutAt = t + CUT_RETRY;
    }
  }
  const s = slots[p.slot];
  steerTo(p, s.x, s.z, false);
}

// Shared by both sides (7.2 / 7.3): after a shot everyone within 4.5 m of the rim goes to the predicted
// landing point and jumps when the ball is low enough and within 1 m; a loose ball is chased by
// everyone within 5 m plus the nearest player. Returns true when the player is busy with the ball.
function rebound(p, ai, world, nearest) {
  const ball = world.ball, st = ball.state;
  if (st !== 'flight' && st !== 'loose') return false;
  const rim = rimOf(world);
  const dRim = distXZ(p.pos.x, p.pos.z, rim.x, rim.z);
  const dBall = distXZ(p.pos.x, p.pos.z, ball.pos.x, ball.pos.z);
  const go = st === 'flight' ? dRim < REB_RIM_R : (dBall < LOOSE_R || dRim < REB_RIM_R || p === nearest);
  if (!go) return false;
  if (LAND.valid && ball.pos.y > LAND_Y) { A.x = LAND.x; A.z = LAND.z; }
  else { A.x = ball.pos.x; A.z = ball.pos.z; clampCourt(A); }
  steerTo(p, A.x, A.z, st === 'loose' && dBall > CHASE_SPRINT_D);
  const y = ball.pos.y;
  const yMax = st === 'flight' ? REB_FLIGHT_Y : REB_JUMP_Y_MAX;
  if (p.canAct && dBall < REB_JUMP_R && y >= REB_JUMP_Y_MIN && y < yMax) tapBtn(p.intent.primary, world.time * 1000);
  return true;
}

// ---------------------------------------------------------------- defence (7.3)

function defence(p, ai, world, tick, nearest) {
  const it = p.intent, t = world.time, ms = t * 1000;
  const ball = world.ball, rim = rimOf(world), diff = difficultyOf(world);
  const man = manOf(p, world);
  contest(p, ai, man, world);
  if (rebound(p, ai, world, nearest)) return;
  if (!man) { stopMove(it); return; }
  const handler = ballHandler(world);
  let sprint = false;
  if (tick && handler && handler !== man && ai.helpUntil <= t) maybeHelp(p, ai, world, handler);
  if (ai.helpUntil > t && handler) {
    // HELP: 1 m in front of the rim on the handler's path.
    dirTo(G, handler.pos.x, handler.pos.z, rim.x, rim.z);
    A.x = rim.x - G.x * HELP_FRONT; A.z = rim.z - G.z * HELP_FRONT;
    sprint = distXZ(p.pos.x, p.pos.z, A.x, A.z) > HELP_SPRINT_D;
  } else if (man === handler) {
    sprint = !!man.sprinting;
    const dMan = distXZ(p.pos.x, p.pos.z, man.pos.x, man.pos.z);
    // ON-BALL: defGap from the (delayed) attacker along attacker -> rim.
    man.getDelayed(D, diff.reaction);
    dirTo(G, D.x, D.z, rim.x, rim.z);
    const gap = Math.max(0, Math.min(diff.defGap, distXZ(D.x, D.z, rim.x, rim.z) - GAP_RIM_MARGIN));
    A.x = D.x + G.x * gap; A.z = D.z + G.z * gap;
    // STEAL (5.11): at most one attempt per 1.5 s, only while the dribbler is inside 1.0 m (the
    // handler driving or crossing into the defender); game.js rolls stealRate x bonuses.
    if (tick && t >= ai.stealAt && man.ballMode === 'dribble' && p.canAct && p.stealCd <= 0 && dMan < MOVE.STEAL_CPU_RANGE) {
      tapBtn(it.tertiary, ms);
      ai.stealAt = t + MOVE.STEAL_CPU_INTERVAL;
    }
  } else {
    // OFF-BALL: sag toward the rim (more when the attacker is beyond the arc), shaded toward the ball.
    man.getDelayed(D, diff.reaction);
    const k = isThree(D.x, D.z) ? OFF_LERP_ARC : OFF_LERP_IN;
    A.x = lerp(D.x, rim.x, k); A.z = lerp(D.z, rim.z, k);
    dirTo(G, A.x, A.z, ball.pos.x, ball.pos.z);
    A.x += G.x * OFF_TOWARD_BALL; A.z += G.z * OFF_TOWARD_BALL;
  }
  clampCourt(A);
  steerTo(p, A.x, A.z, sprint);
}

// Contest: my man started a windup within 1.6 m -> jump (primary) once reactionDelay has elapsed.
function contest(p, ai, man, world) {
  if (!man) { ai.contestAt = -1; return; }
  const st = man.state;
  if (st !== 'windup' && st !== 'layup' && st !== 'release') { ai.contestAt = -1; return; }
  const t = world.time;
  if (ai.contestAt === -1) {
    if (st === 'release') return;
    if (distXZ(p.pos.x, p.pos.z, man.pos.x, man.pos.z) >= CONTEST_R) return;
    ai.contestAt = t + difficultyOf(world).reaction;
  }
  if (ai.contestAt >= 0 && t >= ai.contestAt && p.canAct) {
    tapBtn(p.intent.primary, t * 1000);
    ai.contestAt = -2;                        // done for this shot
  }
}

// Help rotation: the handler is within 3.2 m of the rim with his defender behind him; the nearest
// CPU off-ball defender rotates with probability `help` per tick and commits for 1.5 s.
function maybeHelp(p, ai, world, handler) {
  const rim = rimOf(world);
  if (distXZ(handler.pos.x, handler.pos.z, rim.x, rim.z) >= HELP_RIM_R) return;
  const hd = guardOf(handler, world);
  if (hd) {
    const dot = (hd.pos.x - handler.pos.x) * (rim.x - handler.pos.x) + (hd.pos.z - handler.pos.z) * (rim.z - handler.pos.z);
    if (dot >= 0) return;
  }
  const myD = distXZ(p.pos.x, p.pos.z, handler.pos.x, handler.pos.z);
  const ps = world.players;
  for (let i = 0; i < ps.length; i++) {
    const q = ps[i];
    if (q === p || q.team === handler.team || q.defAssign === handler || userControls(world, q)) continue;
    if (distXZ(q.pos.x, q.pos.z, handler.pos.x, handler.pos.z) < myD) return;
  }
  if (world.rng.next() < difficultyOf(world).help) ai.helpUntil = world.time + HELP_T;
}
