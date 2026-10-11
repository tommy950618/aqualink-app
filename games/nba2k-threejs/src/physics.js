/**
 * @module physics
 * Ball physics and body separation (v1 spec §5.1–§5.5, §5.9, §5.14; v2 spec §5.2, §5.3.7, §5.5, C3, R#31, R#43).
 *
 * Exports
 *   integrateBall(ball, dt), nearRim(pos), collideFloor(ball, dt), collideRim(ball, rng), collideBackboard(ball),
 *   testMadeBasket(prevY, ball), stepFreeBall(ball, dt, rng, out), solveTimed(from, to, T, g, out),
 *   solveArc(from, to, apexAbove, g, out), apexForDistance(d), solvePass(from, to, lob, speed, out),
 *   predictLanding(ball, targetY, out), pairMinDistance(a, b), resolveSeparation(players, out),
 *   RIM_TANGENTIAL, BOARD_TANGENTIAL.
 *
 * A "ball-like" object exposes { pos, prevPos, vel, rimContacts, rimEnabled, boardEnabled } where pos / vel carry
 * numeric x / y / z (THREE.Vector3 or plain objects). Every per-step function writes into the caller's `out` object
 * or into a module scratch object that the next call reuses: nothing allocates per step (H10).
 *
 * v2 changes against v1: rim restitution 0.55 → RIM_PHYS.REST_RIM 0.40 and tangential damping 0.92 →
 * RIM_PHYS.TANGENTIAL 0.80, board restitution 0.60 → RIM_PHYS.REST_BOARD 0.50 (R#31: shorter rim rebounds); chest
 * passes fly at the passer's `passSpeed` with a 0.25 s minimum flight (§5.5) instead of v1's 12 m/s / 0.30 s; the
 * separation pass uses `attrs.bodyR` sums, +0.10 m when either player is airborne, ≥ 0.95 m against a dunker in the
 * hang phase, immovable hanging dunkers / root-motion signature clips, and the box-out favour of §5.6 (C3, R#43).
 */
import {
  RIM, BOARD, BALL, FIXED_DT, RIM_PHYS, SEPARATION, REBOUND, MOVE, DIFFICULTY, BLOCK, STEAL, SHAKE, MOVES_V2, STRENGTH,
  INTERCEPT, JAB, TRIGGERS, POST,
} from './constants.js';
import { clamp } from './math.js';
import { n } from './ratings.js';
import {
  makeAbilityCtx, resetAbilityCtx, blockModifiers, mul, add, has, trigger, comboMul, ankleBase, bumpRule, postGain,
} from './abilities.js';
import { selectCelebration } from './anim/select.js';
import { clipIndex } from './anim/clip.js';
import { SOCK } from './anim/rig.js';

const G = BALL.G;
const R = BALL.R;
const DRAG = BALL.DRAG;
const REACH_RIM = R + RIM.collideTube;          // centre distance at which the ball touches the rim tube
/** Tangential velocity kept on a rim contact (v2 R#31). */
export const RIM_TANGENTIAL = RIM_PHYS.TANGENTIAL;
/** Tangential velocity kept on a board contact (v1 value, unchanged by v2). */
export const BOARD_TANGENTIAL = 0.90;
const RIM_JITTER = 0.05;                         // ±5 % speed jitter on a rim hit (v1)
const KICK_OUT_SPEED = 2.0;                      // horizontal speed used to eject a ball stuck on the rim
const KICK_OUT_VY = 0.5;
const SETTLE_IMPACT = 0.35;                      // a landing slower than this is a rolling ball, not a bounce
const REST_SPEED_SQ = BALL.REST_SPEED * BALL.REST_SPEED;
const PASS_MIN_T = 0.25;                         // §5.5: chest-pass flight max(dist / passSpeed, 0.25)
const PASS_APEX = 0.25;                          // v1 chest-pass arc height
const LOB_APEX = 1.8;                            // §5.5 lob apex
const NEAR_RIM_SQ = BALL.NEAR_RIM_R * BALL.NEAR_RIM_R;

const ARC_OUT = { vx: 0, vy: 0, vz: 0, T: 0 };
// rule-model and contact scratch (module level, reused: H10)
const ACTX = makeAbilityCtx();
const MODS = { eligible: true, behindOK: false, rHand: 0, window: 0, B0Mul: 1, B0: 0, cap: 0, abilityMul: 1, chase: false, pin: false };
const BLOCK_OUT = { eligible: false, pB: 0, B0: 0, blkF: 0, hAdv: 0, cap: 0, abilityMul: 1, sideMul: 1, rHand: 0, window: 0, behindOK: false, chase: false, pin: false };
const POKE_OUT = { eligible: false, pPoke: 0, parts: { S0: 0, stealF: 0, handleF: 0, side: 1, exposed: 1, protect: 1, behind: 1 } };
const SHAKE_OUT = { pShake: 0, pAnkle: 0, handleAdv: 1, commit: 1, comboMul: 1, diffMul: 1, ankleEligible: false };
const BUMP_OUT = { keep: 1, push: 0, stun: false, strDiff: 0, massF: 1, id: null };
const RULE = { stunDiff: 0, pushMul: 1, keepMin: 0, id: null };
const V3 = { x: 0, y: 0, z: 0 };
const P_A = { x: 0, y: 0, z: 0 };
const P_B = { x: 0, y: 0, z: 0 };
const P_HAND = { x: 0, y: 0, z: 0 };
const CEL_CTX = { cls: 'normal', rng: null, streak: 0, assisted: false, gameWinner: false, jumper: false, blocker: false, chaseDown: false };
/** debug.forceCelebrate: a cosmetic Rng stand-in whose every roll succeeds (B60). */
export const CEL_ZERO = Object.freeze({ next: () => 0 });
const JUMPER_FAMILY = { jumper: true, fade: true, stepback: true, turnFade: true };
const DUNK_BALL_VY = -4.5;                               // [ANIM §5.6] slam release (0, −4.5, 0) + 0.3·dir
const HANDS_UP_R = 1.6;                                  // §5.9.3 auto hands-up radius
const C_BUMPED = clipIndex('def.bumped'), C_HAND_UP = clipIndex('def.handUp');
const LAND_OUT = { x: 0, z: 0, t: 0 };
const STEP_OUT = { floor: 0, rim: 0, board: 0, scored: false };
const SEP_OUT = { pairs: 0, maxOverlap: 0 };

// ---------------------------------------------------------------- integration

/** Semi-implicit Euler with linear drag: v.y −= g·dt; v ×= (1 − DRAG·dt); p += v·dt. Returns the ball. */
export function integrateBall(ball, dt) {
  const v = ball.vel, p = ball.pos;
  v.y -= G * dt;
  const k = 1 - DRAG * dt;
  v.x *= k; v.y *= k; v.z *= k;
  p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
  return ball;
}

/** True when the ball centre is inside the sub-stepping radius around the rim (v1 §5.1). */
export function nearRim(pos) {
  const dx = pos.x - RIM.x, dy = pos.y - RIM.y, dz = pos.z - RIM.z;
  return dx * dx + dy * dy + dz * dz < NEAR_RIM_SQ;
}

// ---------------------------------------------------------------- collisions

/**
 * Floor (v1 §5.2). Returns the post-bounce |v.y| when the ball bounced, else 0. Horizontal friction 0.85, or
 * BALL.BACKSPIN_FLOOR 0.40 at the first bounce of a shot that still carries its backspin (`ball.backspin`, cleared). A landing slower than
 * SETTLE_IMPACT is a rolling ball pulled down by one gravity step: it is snapped back to the floor without friction
 * or a bounce event. Rolling decay (v.xz ×= 1 − 2.5·dt) and resting (|v| < 0.3) use dt.
 */
export function collideFloor(ball, dt = FIXED_DT) {
  const p = ball.pos, v = ball.vel;
  let impact = 0;
  if (p.y < R) {
    p.y = R;
    if (v.y < 0) {
      const vIn = -v.y;
      if (vIn > SETTLE_IMPACT) {
        v.y = vIn * BALL.REST_FLOOR;
        // a shot's backspin (untouched since the release) checks the ball up at its first bounce
        const fr = ball.backspin ? BALL.BACKSPIN_FLOOR : BALL.FRICTION_FLOOR;
        ball.backspin = false;
        v.x *= fr;
        v.z *= fr;
        impact = v.y;
        if (v.y < BALL.SETTLE_VY) v.y = 0;
      } else {
        v.y = 0;
      }
    }
  }
  if (v.y === 0 && p.y <= R) {
    const f = Math.max(0, 1 - BALL.ROLL_DECEL * dt);
    v.x *= f;
    v.z *= f;
    if (v.x * v.x + v.z * v.z < REST_SPEED_SQ) { v.x = 0; v.z = 0; }
  }
  return impact;
}

/**
 * Rim: sphere vs torus (v1 §5.3) with the v2 restitution 0.40 and tangential damping 0.80 (R#31). Returns the
 * normal impact speed |vn| on a bounce, else 0. Skipped while ball.rimEnabled === false. After more than
 * MAX_RIM_CONTACTS hits in one flight the ball is kicked outward and rim collision is switched off for that flight.
 */
export function collideRim(ball, rng) {
  if (ball.rimEnabled === false) return 0;
  const p = ball.pos, v = ball.vel;
  const qx = p.x - RIM.x, qy = p.y - RIM.y, qz = p.z - RIM.z;
  const dLen = Math.sqrt(qx * qx + qz * qz);
  if (dLen < 1e-4) return 0;
  // Closest point of the tube centreline (a circle of radius RIM.r in the rim plane).
  const ux = qx / dLen, uz = qz / dLen;
  const rx = ux * RIM.r, rz = uz * RIM.r;
  let nx = qx - rx, ny = qy, nz = qz - rz;
  const dist = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (dist >= REACH_RIM) return 0;
  if (dist > 1e-6) { nx /= dist; ny /= dist; nz /= dist; } else { nx = 0; ny = 1; nz = 0; }
  p.x = RIM.x + rx + nx * REACH_RIM;
  p.y = RIM.y + ny * REACH_RIM;
  p.z = RIM.z + rz + nz * REACH_RIM;
  const vn = v.x * nx + v.y * ny + v.z * nz;
  if (vn >= 0) return 0;
  // Reflect the normal part with restitution e and keep RIM_TANGENTIAL of the tangential part:
  // v' = (v − vn·n)·kt − e·vn·n.
  const e = RIM_PHYS.REST_RIM, kt = RIM_TANGENTIAL;
  v.x = (v.x - vn * nx) * kt - e * vn * nx;
  v.y = (v.y - vn * ny) * kt - e * vn * ny;
  v.z = (v.z - vn * nz) * kt - e * vn * nz;
  if (rng) {
    const s = 1 + rng.range(-RIM_JITTER, RIM_JITTER);
    v.x *= s; v.y *= s; v.z *= s;
  }
  ball.rimContacts = (ball.rimContacts | 0) + 1;
  if (ball.rimContacts > BALL.MAX_RIM_CONTACTS) {
    v.x = ux * KICK_OUT_SPEED;
    v.z = uz * KICK_OUT_SPEED;
    if (v.y < KICK_OUT_VY) v.y = KICK_OUT_VY;
    ball.rimEnabled = false;
  }
  return -vn;
}

/**
 * Backboard: sphere vs AABB (v1 §5.4) with the v2 restitution 0.50. Returns |vn| on a hit, else 0. Skipped while
 * ball.boardEnabled === false (a ball object without that field always collides).
 */
export function collideBackboard(ball) {
  if (ball.boardEnabled === false) return 0;
  const p = ball.pos, v = ball.vel;
  const cx = clamp(p.x, BOARD.min.x, BOARD.max.x);
  const cy = clamp(p.y, BOARD.min.y, BOARD.max.y);
  const cz = clamp(p.z, BOARD.min.z, BOARD.max.z);
  let nx = p.x - cx, ny = p.y - cy, nz = p.z - cz;
  const dist = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (dist >= R) return 0;
  if (dist > 1e-4) { nx /= dist; ny /= dist; nz /= dist; } else { nx = 0; ny = 0; nz = 1; }
  p.x = cx + nx * R;
  p.y = cy + ny * R;
  p.z = cz + nz * R;
  const vn = v.x * nx + v.y * ny + v.z * nz;
  if (vn >= 0) return 0;
  const e = RIM_PHYS.REST_BOARD, kt = BOARD_TANGENTIAL;
  v.x = (v.x - vn * nx) * kt - e * vn * nx;
  v.y = (v.y - vn * ny) * kt - e * vn * ny;
  v.z = (v.z - vn * nz) * kt - e * vn * nz;
  return -vn;
}

/**
 * Made-basket detector (v1 §5.5): the centre crossed the rim plane downward inside the cylinder of radius
 * RIM.r − 0.6·R during this step. prevY is the centre height before the step.
 */
export function testMadeBasket(prevY, ball) {
  const p = ball.pos;
  if (!(prevY > RIM.y && p.y <= RIM.y && ball.vel.y < 0)) return false;
  const dx = p.x - RIM.x, dz = p.z - RIM.z;
  return dx * dx + dz * dz < BALL.SCORE_R * BALL.SCORE_R;
}

/**
 * One free-ball step with the v1 §5.1 sub-stepping: near the rim the step runs as two half-steps, each followed by a
 * full collision pass. out.{floor, rim, board} hold the strongest impact of each kind (0 when none) and out.scored is
 * true if any sub-step satisfied testMadeBasket.
 */
export function stepFreeBall(ball, dt, rng, out = STEP_OUT) {
  out.floor = 0; out.rim = 0; out.board = 0; out.scored = false;
  const n = nearRim(ball.pos) ? 2 : 1;
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const prevY = ball.pos.y;
    integrateBall(ball, h);
    const f = collideFloor(ball, h);
    const r = collideRim(ball, rng);
    const b = collideBackboard(ball);
    if (f > out.floor) out.floor = f;
    if (r > out.rim) out.rim = r;
    if (b > out.board) out.board = b;
    if (!out.scored && testMadeBasket(prevY, ball)) out.scored = true;
  }
  return out;
}

// ---------------------------------------------------------------- arc solvers

/**
 * Launch velocity that brings integrateBall from `from` to `to` in exactly N = round(T / FIXED_DT) steps.
 * Inverting the discrete recurrence v[n+1] = k(v[n] − g·dt), p[n+1] = p[n] + v[n+1]·dt with k = 1 − DRAG·dt gives
 * p[N] − p[0] = dt·(N·v* + (v0 − v*)·S) with the terminal velocity v* = −k·g / DRAG and S = k(1 − k^N)/(1 − k);
 * solving for v0 per axis (v* = 0 horizontally) yields the exact launch velocity of the integrator, so a ball aimed
 * at the rim centre really arrives there (the continuous closed form lands ≈ 0.1 m low over a 1.3 s arc).
 */
export function solveTimed(from, to, T, g = G, out = ARC_OUT) {
  const dt = FIXED_DT;
  const N = Math.max(1, Math.round(T / dt));
  const k = 1 - DRAG * dt;
  const S = k * (1 - Math.pow(k, N)) / (1 - k);
  const vTerm = -k * g / DRAG;
  out.vx = (to.x - from.x) / (dt * S);
  out.vz = (to.z - from.z) / (dt * S);
  out.vy = vTerm + ((to.y - from.y) / dt - N * vTerm) / S;
  out.T = N * dt;
  return out;
}

/**
 * Arc through an apex `apexAbove` metres over the higher endpoint (v1 §4.5): T from the continuous ballistic arc
 * (rise to the apex + fall from it), velocities corrected for the integrator by solveTimed. out = {vx, vy, vz, T}.
 */
export function solveArc(from, to, apexAbove, g = G, out = ARC_OUT) {
  const apexY = Math.max(from.y, to.y) + apexAbove;
  const vy0 = Math.sqrt(2 * g * (apexY - from.y));
  const tUp = vy0 / g;
  const tDown = Math.sqrt(2 * (apexY - to.y) / g);
  return solveTimed(from, to, tUp + tDown, g, out);
}

/** v1 §4.5 apex table by shot distance (m above the higher endpoint). */
export function apexForDistance(d) {
  if (d < 2) return 1.0;
  if (d < 5) return 1.6;
  if (d < 7.5) return 2.1;
  return 2.6;
}

/**
 * Pass trajectory (§5.5, C6): a lob rises 1.8 m above the higher endpoint at its natural speed; a chest / bounce /
 * skip pass flies in T = max(dist / speed, 0.25) s (speed = the passer's `passSpeed`, 15 m/s for LeBron's skip
 * flick, 10 m/s for a human pass beyond range). `to` is the receiver's predicted chest point.
 */
export function solvePass(from, to, lob, speed, out = ARC_OUT) {
  if (lob) return solveArc(from, to, LOB_APEX, G, out);
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const v = speed > 0 ? speed : 12;
  const tFast = Math.max(dist / v, PASS_MIN_T);
  // A short pass on a flatter arc than PASS_APEX would be slower than tFast; the timed solution is always used so
  // the flight time is exactly the §5.5 value (the arc height follows from it).
  solveArc(from, to, PASS_APEX, G, out);
  if (Math.abs(out.T - tFast) > 1e-9) solveTimed(from, to, tFast, G, out);
  return out;
}

/**
 * Where the current parabola (no drag, no collisions) descends through y = targetY (v1 §5.14). Writes {x, z, t} into
 * out and returns it, or null when the ball never comes down through targetY.
 */
export function predictLanding(ball, targetY = 1.8, out = LAND_OUT) {
  const p = ball.pos, v = ball.vel;
  // 0.5·g·t² − vy·t + (targetY − y) = 0; the larger root is the descending crossing.
  const disc = v.y * v.y - 2 * G * (targetY - p.y);
  if (disc < 0) return null;
  const t = (v.y + Math.sqrt(disc)) / G;
  if (t <= 0) return null;
  out.x = p.x + v.x * t;
  out.z = p.z + v.z * t;
  out.t = t;
  return out;
}

// ---------------------------------------------------------------- separation (§5.2, C3)

function bodyR(p) {
  return p.attrs && p.attrs.bodyR > 0 ? p.attrs.bodyR : MOVE.RADIUS;
}

function strengthOf(p) {
  return p.legend && p.legend.ratings ? p.legend.ratings.strength : 50;
}

/**
 * Minimum centre distance of a pair (§5.2): bodyR_a + bodyR_b, + 0.10 m when either is airborne, at least 0.95 m
 * when either is a dunker in the hang phase (`hanging`).
 */
export function pairMinDistance(a, b) {
  let d = bodyR(a) + bodyR(b);
  if (a.isJumping || b.isJumping) d += SEPARATION.AIR_ADD;
  if ((a.hanging || b.hanging) && d < SEPARATION.DUNKER_MIN) d = SEPARATION.DUNKER_MIN;
  return d;
}

/**
 * Share of a pair's overlap that player `a` takes (0..1). Immovable players (`sepFixed`: a hanging dunker or a
 * root-motion signature clip) take nothing; a box-out (`boxT > 0`, boxing against the other player) is favoured by
 * f = 0.3 + 0.004·strDiff (§5.6): the boxer moves (1 − f)/2 of the overlap, the other (1 + f)/2.
 */
function shareOf(a, b) {
  const aFixed = !!a.sepFixed, bFixed = !!b.sepFixed;
  if (aFixed && bFixed) return 0;
  if (aFixed) return 0;
  if (bFixed) return 1;
  const aBox = a.boxT > 0 && a.boxing === b, bBox = b.boxT > 0 && b.boxing === a;
  if (aBox !== bBox) {
    const boxer = aBox ? a : b, other = aBox ? b : a;
    const f = clamp(REBOUND.BOX_BASE + REBOUND.BOX_K * (strengthOf(boxer) - strengthOf(other)), 0, 0.9);
    return aBox ? (1 - f) * 0.5 : (1 + f) * 0.5;
  }
  return 0.5;
}

/**
 * Separation pass over all pairs (§5.2, C3; fixes R#43): pairs closer than pairMinDistance are pushed apart along
 * their centre line, split by shareOf. Positions only (velocities are gameplay's). Players with `clampToCourt` and
 * not `isUser` are re-clamped to the AI court box afterwards (v1 §5.10). Returns out {pairs, maxOverlap}.
 */
export function resolveSeparation(players, out = SEP_OUT) {
  out.pairs = 0; out.maxOverlap = 0;
  const n = players.length;
  for (let i = 0; i < n; i++) {
    const a = players[i];
    for (let j = i + 1; j < n; j++) {
      const b = players[j];
      let dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      let d = Math.sqrt(dx * dx + dz * dz);
      const minD = pairMinDistance(a, b);
      if (d >= minD) continue;
      if (d < 1e-4) { dx = (i & 1) ? 1 : -1; dz = 0; d = 1e-4; }
      const over = minD - d;
      const ux = dx / d, uz = dz / d;
      const sa = shareOf(a, b);
      const sb = (a.sepFixed && b.sepFixed) ? 0 : 1 - sa;
      a.pos.x -= ux * over * sa; a.pos.z -= uz * over * sa;
      b.pos.x += ux * over * sb; b.pos.z += uz * over * sb;
      out.pairs++;
      if (over > out.maxOverlap) out.maxOverlap = over;
    }
  }
  for (let i = 0; i < n; i++) {
    const p = players[i];
    if (p.clampToCourt && !p.isUser) {
      const q = p.pos;
      if (q.x > MOVE.AI_CLAMP_X) q.x = MOVE.AI_CLAMP_X; else if (q.x < -MOVE.AI_CLAMP_X) q.x = -MOVE.AI_CLAMP_X;
      if (q.z > MOVE.AI_CLAMP_Z_MAX) q.z = MOVE.AI_CLAMP_Z_MAX; else if (q.z < MOVE.AI_CLAMP_Z_MIN) q.z = MOVE.AI_CLAMP_Z_MIN;
    }
  }
  return out;
}

// ================================================================================================ shared helpers

/** dot(dir(a → b), dir(a → (tx, tz))); 0 when degenerate. */
export function frontDotTo(a, b, tx, tz) {
  const bx = b.pos.x - a.pos.x, bz = b.pos.z - a.pos.z, tx2 = tx - a.pos.x, tz2 = tz - a.pos.z;
  const bl = Math.sqrt(bx * bx + bz * bz), tl = Math.sqrt(tx2 * tx2 + tz2 * tz2);
  return bl < 1e-6 || tl < 1e-6 ? 0 : (bx * tx2 + bz * tz2) / (bl * tl);
}

/**
 * Who acts, for the difficulty multipliers (§5.3.4, §5.4, §5.5, §5.7, §5.11): 'auto' (CPU-vs-CPU game), 'human' (the
 * controlled player), 'cpu' (a CPU opponent of the human team) or 'mate' (the human's CPU teammate: normal column, 1.0).
 */
export function sideOf(p, game) {
  const w = game.world;
  if (w.auto) return 'auto';
  if (p === w.controlled) return 'human';
  return p.team !== w.user ? 'cpu' : 'mate';
}

/** The opponent within r in front of p toward the rim (dot ≥ 0.5), nearest first, or null (post / lane defender). */
export function frontDefender(p, players, r) {
  let best = null, bestD = r;
  const rx = RIM.x - p.pos.x, rz = RIM.z - p.pos.z, rl = Math.sqrt(rx * rx + rz * rz) || 1;
  for (let i = 0; i < players.length; i++) {
    const o = players[i];
    if (o.team === p.team || o.disabled) continue;
    const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z, d = Math.sqrt(dx * dx + dz * dz);
    if (d > bestD || d < 1e-6 || (dx * rx + dz * rz) / (d * rl) < 0.5) continue;
    best = o; bestD = d;
  }
  return best;
}

// ================================================================================================ rule models (§5.4–§5.7; re-exported by game.js)

/**
 * Block probability of defender `def` against `shooter` for a shot of `kind` (§5.4): pB = min(CAP, B0 × blkF × hAdv ×
 * abilityMul) × sideMul, blkF = 0.35 + 0.85·n(block), hAdv = clamp(1 + 0.625·(H_def − H_sh), 0.60, 1.35); a jumper-
 * family shot in the close zone uses the close row; LeBron's chase-down B0 0.50 / cap 0.55; dunk stuffs B0 0.22 /
 * cap 0.30. opts {variant, zone, side ('human'|'cpu'|'mate'|'auto' of the blocker), difficulty, chasing, help, log, t,
 * dunk}. Writes BLOCK_OUT (or out).
 */
export function blockChance(shooter, def, kind, opts, out = BLOCK_OUT) {
  const o = opts || {};
  const c = resetAbilityCtx(ACTX);
  c.kind = kind; c.variant = o.variant || null; c.zone = o.zone || null; c.helpDefender = !!o.help; c.log = o.log || null; c.t = o.t || 0;
  c.shooter = shooter;
  blockModifiers(shooter, def, c, !!o.chasing, MODS);
  let B0 = MODS.B0 * MODS.B0Mul, cap = MODS.cap, win = MODS.window;
  if (JUMPER_FAMILY[kind] && o.zone === 'close' && !MODS.chase) { B0 = BLOCK.B0.close * MODS.B0Mul; cap = BLOCK.CAP.close; win = BLOCK.WINDOW.close; }
  if (o.dunk || kind === 'dunk') {
    if (MODS.chase) { B0 = BLOCK.CHASE_B0; cap = BLOCK.CHASE_CAP; } else { B0 = BLOCK.DUNK_B0; cap = BLOCK.DUNK_CAP; }
  }
  const Ld = def.legend, Ls = shooter.legend;
  const blkF = BLOCK.BLKF_BASE + BLOCK.BLKF_K * n(Ld.ratings.block);
  const hAdv = clamp(1 + BLOCK.HADV_K * (Ld.stats.heightM - Ls.stats.heightM), BLOCK.HADV_MIN, BLOCK.HADV_MAX);
  const D = DIFFICULTY[o.difficulty] || DIFFICULTY.normal;
  const sideMul = o.side === 'human' ? D.userBlockMul : o.side === 'cpu' ? D.cpuBlockMul : 1;
  out.eligible = MODS.eligible; out.B0 = B0; out.blkF = blkF; out.hAdv = hAdv; out.cap = cap; out.abilityMul = MODS.abilityMul;
  out.sideMul = sideMul; out.rHand = MODS.rHand; out.window = win; out.behindOK = MODS.behindOK; out.chase = MODS.chase; out.pin = MODS.pin;
  out.pB = MODS.eligible ? Math.min(cap, B0 * blkF * hAdv * MODS.abilityMul) * sideMul : 0;
  return out;
}

/**
 * On-ball poke (§5.5): pPoke = clamp(S0 × stealF × handleF × side × exposed × protect × behind, 0.03, 0.45). opts
 * {side ('human'|'cpu'|'mate'|'auto' of the poker), difficulty, ballNear (ball on the dribble hand nearer the
 * defender), exposed, protect, behind, eligible, log, t}. Writes POKE_OUT.
 */
export function pokeChance(def, handler, opts, out = POKE_OUT) {
  const o = opts || {};
  const D = DIFFICULTY[o.difficulty] || DIFFICULTY.normal;
  const S0 = o.side === 'human' ? STEAL.S0_HUMAN : o.side === 'cpu' ? D.cpuStealS0 : DIFFICULTY.normal.cpuStealS0;
  const c = resetAbilityCtx(ACTX); c.what = 'stealF'; c.log = o.log || null; c.t = o.t || 0;
  const stealF = (STEAL.STEALF_BASE + STEAL.STEALF_K * n(def.legend.ratings.steal)) * mul(def, 'steal', c);
  const handleF = STEAL.HANDLEF_BASE - STEAL.HANDLEF_K * n(handler.legend.ratings.ballHandle);
  const side = o.ballNear === undefined ? 1 : (o.ballNear ? STEAL.SIDE_NEAR : STEAL.SIDE_FAR);
  const exposed = o.exposed ? STEAL.EXPOSED : 1, protect = o.protect ? STEAL.PROTECT : 1, behind = o.behind ? STEAL.BEHIND : 1;
  const P = out.parts;
  P.S0 = S0; P.stealF = stealF; P.handleF = handleF; P.side = side; P.exposed = exposed; P.protect = protect; P.behind = behind;
  out.eligible = o.eligible !== false;
  out.pPoke = clamp(S0 * stealF * handleF * side * exposed * protect * behind, STEAL.P_MIN, STEAL.P_MAX);
  return out;
}

/**
 * Shake / ankle-break of a dribble move (§5.7): handleAdv = clamp(1 + (ballHandle_h − perimeterD_d)/50, 0.4, 1.6);
 * pAnkle = ankle-eligible ? clamp(AB0 × handleAdv × commit × comboMul × diffMul, 0, 0.35) : 0; pShake =
 * clamp(0.22 × moveMul × handleAdv × commit × diffMul, 0.04, 0.60). opts {committed, combo (chain index), diffMul}.
 */
export function shakeChance(handler, def, moveId, opts, out = SHAKE_OUT) {
  const o = opts || {};
  const M = MOVES_V2[moveId] || MOVES_V2['move.cross'];
  const handleAdv = clamp(1 + (handler.legend.ratings.ballHandle - def.legend.ratings.perimeterD) / SHAKE.HANDLE_DIV, SHAKE.HANDLE_MIN, SHAKE.HANDLE_MAX);
  const commit = o.committed ? SHAKE.COMMIT : 1;
  const cm = comboMul(handler, o.combo || 1);
  const dm = o.diffMul > 0 ? o.diffMul : 1;
  const ankleOK = !!M.ankle && (!M.ankleKyrieOnly || has(handler, 'kyrie.combo'));
  out.handleAdv = handleAdv; out.commit = commit; out.comboMul = cm; out.diffMul = dm; out.ankleEligible = ankleOK;
  out.pAnkle = ankleOK ? clamp(ankleBase(handler) * handleAdv * commit * cm * dm, 0, SHAKE.ANKLE_MAX) : 0;
  out.pShake = clamp(SHAKE.P_BASE * M.moveMul * handleAdv * commit * dm, SHAKE.P_MIN, SHAKE.P_MAX);
  return out;
}

/**
 * Drive bump (§5.6): keep = clamp(0.55 + 0.006·strDiff + 0.25·(massF − 1), 0.25, 0.95) (LeBron power drive ≥ 0.80),
 * push = clamp(0.10 + 0.008·strDiff, 0, 0.45) × pushMul, stun when strDiff ≥ stunDiff (20; LeBron 10) and speed ≥ 4.0.
 */
export function bumpOutcome(handler, def, speed, out = BUMP_OUT) {
  const c = resetAbilityCtx(ACTX);
  bumpRule(handler, speed, c, RULE);
  const strDiff = handler.legend.ratings.strength - def.legend.ratings.strength;
  const massF = handler.legend.stats.weightKg / def.legend.stats.weightKg;
  out.strDiff = strDiff; out.massF = massF; out.id = RULE.id;
  out.keep = Math.max(RULE.keepMin, clamp(STRENGTH.KEEP_BASE + STRENGTH.KEEP_K * strDiff + STRENGTH.KEEP_MASS * (massF - 1), STRENGTH.KEEP_MIN, STRENGTH.KEEP_MAX));
  out.push = clamp(STRENGTH.PUSH_BASE + STRENGTH.PUSH_K * strDiff, STRENGTH.PUSH_MIN, STRENGTH.PUSH_MAX) * RULE.pushMul;
  out.stun = strDiff >= RULE.stunDiff && speed >= STRENGTH.STUN_SPEED;
  return out;
}

/** Interception roll probability (§5.5): pInt = clamp(0.35 + 0.45·n(steal) − 0.15·(dist / intR), 0.15, 0.85). */
export function interceptChance(def, dist, intR) {
  return clamp(INTERCEPT.P_BASE + INTERCEPT.P_K * n(def.legend.ratings.steal) - INTERCEPT.P_DIST_K * (dist / intR), INTERCEPT.P_MIN, INTERCEPT.P_MAX);
}

/** Jab / pump-fake bite (§5.7): pBite = biteBase × (1.15 − 0.50·n(perimeterD)) × the jabber's `move` bite multiplier. */
export function biteChance(def, biteBase, biteMul) {
  return clamp(biteBase * (JAB.BITE_BASE_K - JAB.BITE_PERD_K * n(def.legend.ratings.perimeterD)) * (biteMul || 1), 0, 1);
}

/**
 * Matchup cost of defender d on attacker a (§5.10): 1.5·|H_d − H_a| + 0.02·max(0, speed_a − speed_d) + (guardBest_d
 * and a is the attacker with the highest checkShare ? −0.5 : 0) + (speed_a − speed_d > 30 ? 2.0 : 0).
 */
export function matchupCost(d, a, topCheck) {
  const Ld = d.legend, La = a.legend;
  const ds = La.ratings.speed - Ld.ratings.speed;
  let c = 1.5 * Math.abs(Ld.stats.heightM - La.stats.heightM) + 0.02 * Math.max(0, ds);
  if (Ld.tend.guardBest && a === topCheck) c -= 0.5;
  if (ds > 30) c += 2.0;
  return c;
}

export const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

// ================================================================================================ contact mixin

/**
 * Game methods for body / ball contacts (installed on Game.prototype by game.js): dunk slams and stuffs, blocks,
 * Jordan's mid-air switch, drive bumps, post shoves, drive tracking, auto hands-up, interceptions and box-outs
 * (§5.4–§5.6, [ANIM §5.6], R11). `this` is the Game.
 */
export class ContactMixin {
  // ---------------------------------------------------------------- dunks (§5.4 stuffs, [ANIM §5.6], R11)
  resolveSlam(p) {
    const s = p.shot, w = this.world, ball = this.ball;
    s.slamDone = true;
    if (ball.owner !== p) { s.active = false; return; }
    s.released = true; s.releaseInT = w.time; s.x = p.pos.x; s.z = p.pos.z;
    this.evaluateAndRoll(p, NaN);
    p.animator.querySocket(SOCK.ball, P_HAND);
    // the ball is slammed from the hand above the rim; keep it inside the 0.30 m-per-step budget (B47)
    let dx = RIM.x - P_HAND.x, dz = RIM.z - P_HAND.z;
    const dl = Math.sqrt(dx * dx + dz * dz);
    if (dl > 0.30) { P_HAND.x += dx / dl * (dl - 0.30); P_HAND.z += dz / dl * (dl - 0.30); dx = RIM.x - P_HAND.x; dz = RIM.z - P_HAND.z; }
    if (P_HAND.y < RIM.y + 0.10) P_HAND.y = RIM.y + 0.10;
    const dl2 = Math.sqrt(dx * dx + dz * dz) || 1;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    s.launched = true;
    if (s.make) {
      V3.x = 0.3 * dx / dl2; V3.y = DUNK_BALL_VY; V3.z = 0.3 * dz / dl2;
      ball.launch(V3, 'scored', P_HAND);
      this.bookShotLaunch(p);
      const e = this.ev('slam', p); e.kind = 'dunk'; e.variant = s.variant; this.fire(e);
      this.onScore(2, p, true);
    } else {
      V3.x = BLOCK.RIMOUT_FWD * fx; V3.y = BLOCK.RIMOUT_UP; V3.z = BLOCK.RIMOUT_FWD * fz;
      ball.launch(V3, 'loose', P_HAND);
      this.bookShotLaunch(p);
      ball.shot.touched = true; ball.contacted = true;
      const e = this.ev('slam', p); e.kind = 'dunk'; e.variant = s.variant; e.what = 'rimOut'; this.fire(e);
      this.caption('cap.rimOut', p, 3);
      this.resolveMiss(false);
    }
  }

  /** Dunk stuff (§5.4): rising phase to slam − 0.05, airborne defender in front, hand within 0.30 m of the ball. */
  tryStuff(p) {
    const s = p.shot, w = this.world;
    if (!p.isJumping || s.slamDone || !s.timing || s.timing.profile == null) return;
    const slamAt = s.timing.profile.slam;
    if (p.jumpT > slamAt - BLOCK.DUNK_SLAM_MARGIN) return;
    p.animator.querySocket(SOCK.ball, P_A);
    for (let i = 0; i < 6; i++) {
      const d = this.players[i];
      if (d.team === p.team || !d.isJumping || d.disabled || this.stuffRolled[d.idx] || d === s.excluded) continue;
      const front = frontDotTo(p, d, RIM.x, RIM.z);
      const chase = d.chaseShooter === p && has(d, 'lebron.chaseDown');
      if (front < BLOCK.DUNK_FRONT_DOT && !chase) continue;
      if (chase && s.variant === 'ftDunk' && front < BLOCK.DUNK_FRONT_DOT) continue;   // FT-line dunk: not from behind
      const r = this.palmDist(d, P_A);
      if (r > (chase ? BLOCK.R_HAND_CHASE : BLOCK.R_HAND)) continue;
      this.stuffRolled[d.idx] = 1;
      const B = blockChance(p, d, 'dunk', { variant: s.variant, zone: 'dunk', side: sideOf(d, this), difficulty: this.difficultyId, chasing: chase, help: d.defAssign !== null && d.defAssign !== p, log: this.abilityLog, t: w.time, dunk: true });
      if (this.rng.next() >= B.pB) continue;
      // stuffed: the dunk aborts into a drop, the ball pops loose
      s.slamDone = true; s.launched = true; s.released = true; s.releaseInT = w.time; s.x = p.pos.x; s.z = p.pos.z; s.zone = 'dunk';
      p.animator.stopAction(); p.abortJumpToDrop();
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
      V3.x = BLOCK.STUFF_FWD * fx; V3.y = BLOCK.STUFF_UP; V3.z = BLOCK.STUFF_FWD * fz;
      this.ball.launch(V3, 'loose', P_A);
      this.bookShotLaunch(p);
      this.applyBlock(d, p, chase, false);
      return;
    }
  }

  palmDist(d, at) {
    d.animator.querySocket(SOCK.palm_r, P_B);
    const r1 = Math.sqrt((P_B.x - at.x) ** 2 + (P_B.y - at.y) ** 2 + (P_B.z - at.z) ** 2);
    d.animator.querySocket(SOCK.palm_l, P_B);
    const r2 = Math.sqrt((P_B.x - at.x) ** 2 + (P_B.y - at.y) ** 2 + (P_B.z - at.z) ** 2);
    return r1 < r2 ? r1 : r2;
  }

  applyBlock(d, shooter, chase, pin) {
    const ball = this.ball;
    ball.lastToucher = d; ball.shot.touched = true; ball.shot.blocked = true; ball.contacted = true;
    ball.exclude1 = d; ball.exclude2 = shooter;          // the swatted ball flies free for 0.3 s (no instant self-catch)
    d.stats.blk++;
    this.metrics.block(d.id, d.team, shooter.team);
    this.pending.missed = true;      // a blocked shot is not captioned as a miss
    this.caption(chase ? 'cap.chaseDown' : 'cap.block', d, 2);
    const e = this.ev('block', d); e.blockerId = d.id; e.shooterId = shooter.id; e.pin = !!pin; e.chaseDown = !!chase; this.fire(e);
    if (typeof d.animator.contact === 'function') d.animator.contact(ball.pos.x, ball.pos.y, ball.pos.z, pin ? 'pin' : 0);
    CEL_CTX.cls = 'normal'; CEL_CTX.rng = this.debug.forceCelebrate ? CEL_ZERO : this.cosRng; CEL_CTX.blocker = true; CEL_CTX.chaseDown = !!chase;
    const sel = selectCelebration(d, CEL_CTX);
    CEL_CTX.blocker = false; CEL_CTX.chaseDown = false;
    if (sel.celebrate) d.celebrate(sel);
    shooter.streak = 0;
  }

  // ---------------------------------------------------------------- contacts (§1.3 step 6)
  stepContacts(dt) {
    const w = this.world, ball = this.ball;
    for (let i = 0; i < 6; i++) {
      const p = this.players[i];
      const s = p.shot;
      if (s.active && s.kind === 'dunk' && !s.slamDone) this.tryStuff(p);
      if (s.active && s.kind === 'layup' && !s.launched && p.isJumping && !s.switchRolled && has(p, 'jordan.air') && p.jumpVyNow() > 0) this.trySwitch(p);
      if (p.team === w.offense && p.hasBall && ball.owner === p) {
        this.tryBump(p);
        if (p.state === 'post') this.stepPost(p, dt);
        this.trackDrive(p);
      }
      this.handsUp(p);
    }
    if (ball.state === 'flight' && ball.ctx === 'shot') this.tryBlocks();
    if (ball.state === 'pass') this.tryInterceptions();
  }

  /** Jordan's mid-air switch (§5.8 jordan.air): a block-eligible hand within 0.70 m of the ball → p 0.75, once. */
  trySwitch(p) {
    p.animator.querySocket(SOCK.ball, P_A);
    let best = Infinity;
    for (let i = 0; i < 6; i++) {
      const d = this.players[i];
      if (d.team === p.team || !d.isJumping || d.disabled) continue;
      const r = this.palmDist(d, P_A);
      if (r < best) best = r;
    }
    if (best > TRIGGERS.JORDAN_SWITCH.HAND_R) return;
    const s = p.shot;
    s.switchRolled = true;
    const c = resetAbilityCtx(ACTX); c.t = this.world.time; c.log = this.abilityLog; c.kind = 'layup'; c.variant = s.variant; c.handDist = best; c.rng = this.rng;
    if (trigger(p, 'blockShooter', c)) s.variant = 'switch';
  }

  /** Drive bump (§5.6): handler ≥ 3.0 m/s reaching a defender within ±45° of his velocity, ≤ once per 0.6 s. */
  tryBump(h) {
    const w = this.world;
    const sp = h.speed;
    if (sp < STRENGTH.BUMP_SPEED || h.isJumping || w.time - h.cx.lastBumpT < STRENGTH.BUMP_INTERVAL) return;
    const cosCone = Math.cos(STRENGTH.BUMP_CONE_DEG * Math.PI / 180);
    for (let i = 0; i < 6; i++) {
      const d = this.players[i];
      if (d.team === h.team || d.disabled || d.isJumping) continue;
      const dx = d.pos.x - h.pos.x, dz = d.pos.z - h.pos.z, dd = Math.sqrt(dx * dx + dz * dz);
      if (dd > pairMinDistance(h, d) + 0.02 || dd < 1e-6) continue;
      if ((dx * h.vel.x + dz * h.vel.z) / (dd * sp) < cosCone) continue;
      h.cx.lastBumpT = w.time;
      const B = bumpOutcome(h, d, sp);
      h.vel.x *= B.keep; h.vel.z *= B.keep;
      d.push(h.vel.x / (h.speed || 1), h.vel.z / (h.speed || 1), B.push, STRENGTH.PUSH_T);
      if (B.stun) d.stun(STRENGTH.STUN_T);
      d.playClip(C_BUMPED, null);
      const won = B.stun || B.keep >= 0.80;
      if (won) h.cx.wonBumpT = w.time;
      if (B.id) { const c = resetAbilityCtx(ACTX); c.t = w.time; c.log = this.abilityLog; c.what = 'push'; c.speed = sp; mul(h, 'drive', c); }
      const e = this.ev('bump', h); e.defenderId = d.id; e.strength = B.push; this.fire(e);
      return;
    }
  }

  /** Post shoves (§5.6): every 0.30 s with the stick at the rim (or the AI's post request) both move toward the rim. */
  stepPost(p, dt) {
    const w = this.world, it = p.intent, cx = p.cx;
    cx.postShoveT += dt;
    const m = it.move;
    const rx = RIM.x - p.pos.x, rz = RIM.z - p.pos.z, rl = Math.sqrt(rx * rx + rz * rz) || 1;
    const ml = Math.sqrt(m.x * m.x + m.z * m.z);
    const atRim = it.post || (ml > 1e-6 && m.mag >= 0.15 && (m.x * rx + m.z * rz) / (ml * rl) >= POST.STICK_DOT);
    if (!atRim || cx.postShoveT < POST.SHOVE_T) return;
    cx.postShoveT = 0;
    const d = frontDefender(p, this.players, POST.DEF_R + 0.4);
    if (!d) return;
    const c = resetAbilityCtx(ACTX); c.t = w.time; c.log = this.abilityLog;
    const gain = postGain(p, d, c);
    p.push(rx / rl, rz / rl, gain, POST.SHOVE_T);
    d.push(rx / rl, rz / rl, gain, POST.SHOVE_T);
  }

  /** Metrics drive tracking: dribbling toward the rim at ≥ 3.0 m/s within 45°. */
  trackDrive(p) {
    const w = this.world;
    const sp = p.speed;
    const rx = RIM.x - p.pos.x, rz = RIM.z - p.pos.z, rl = Math.sqrt(rx * rx + rz * rz) || 1;
    const on = p.dribbling && sp >= 3.0 && (p.vel.x * rx + p.vel.z * rz) / (sp * rl) >= 0.7071;
    if (on !== p.cx.driving) { p.cx.driving = on; this.metrics.drive(p.id, on, w.time); }
  }

  /** Auto hands-up (§5.9.3, C22): grounded defenders within 1.6 m of a shooter in gather / windup / layup. */
  handsUp(d) {
    if (d.team === this.world.offense || !d.canAct || C_HAND_UP < 0) return;
    for (let i = 0; i < 6; i++) {
      const s = this.players[i];
      if (s.team === d.team || !s.shot.active || s.shot.launched) continue;
      const dx = s.pos.x - d.pos.x, dz = s.pos.z - d.pos.z;
      if (dx * dx + dz * dz > HANDS_UP_R * HANDS_UP_R) continue;
      if (d.animator.upper !== C_HAND_UP) d.animator.play(C_HAND_UP, { layer: 'upper' });
      return;
    }
  }

  /** Blocks (§5.4): eligibility each step of a fresh rising shot, one roll per defender per shot. */
  tryBlocks() {
    const w = this.world, ball = this.ball, b = ball.shot, sh = b.shooter;
    if (!sh || b.kind === 'dunk' || b.kind === 'tip' || ball.vel.y <= 0) return;
    for (let i = 0; i < 6; i++) {
      const d = this.players[i];
      if (d.team === sh.team || !d.isJumping || d.disabled || this.blockRolled[d.idx] || d === sh.shot.excluded) continue;
      const help = d.defAssign !== null && d.defAssign !== sh;
      const chasing = d.chaseShooter === sh;
      const B = blockChance(sh, d, b.kind, { variant: b.variant, zone: b.zone, side: sideOf(d, this), difficulty: this.difficultyId, chasing, help, log: null, t: w.time });
      if (ball.releaseAge > B.window || !B.eligible) continue;
      const r = this.palmDist(d, ball.pos);
      if (r > B.rHand) continue;
      if (!B.behindOK && frontDotTo(sh, d, RIM.x, RIM.z) < BLOCK.BEHIND_DOT) continue;
      this.blockRolled[d.idx] = 1;
      // the roll (abilities logged now that the contact is real)
      const B2 = blockChance(sh, d, b.kind, { variant: b.variant, zone: b.zone, side: sideOf(d, this), difficulty: this.difficultyId, chasing, help, log: this.abilityLog, t: w.time });
      if (this.rng.next() >= B2.pB) continue;
      const side = this.rng.next() < 0.5 ? -1 : 1;
      const nearBoard = Math.abs(ball.pos.z - BOARD.max.z) <= BLOCK.PIN_BOARD_R && Math.abs(ball.pos.x) <= BOARD.max.x + 0.3;
      const pin = B2.pin && nearBoard;
      if (pin) { V3.x = BLOCK.PIN_V.side * side * this.rng.next(); V3.y = BLOCK.PIN_V.up; V3.z = BLOCK.PIN_V.z; }
      else {
        V3.x = -BLOCK.BACK_K * ball.vel.x + this.rng.range(-BLOCK.SIDE_V, BLOCK.SIDE_V) * side;
        V3.y = BLOCK.UP_V + BLOCK.UP_V_RAND * this.rng.next();
        V3.z = -BLOCK.BACK_K * ball.vel.z;
      }
      ball.launch(V3, 'loose', null);
      ball.ctx = 'shot';
      this.applyBlock(d, sh, B2.chase, pin);
      return;
    }
  }

  /** Interceptions (§5.5, R#34): one roll per defender per pass → catch (STL) / 50 % deflection / nothing. */
  tryInterceptions() {
    const w = this.world, ball = this.ball, from = ball.passInfo.from;
    if (!from) return;
    for (let i = 0; i < 6; i++) {
      const d = this.players[i];
      if (d.team === from.team || d.disabled || this.intRolled[d.idx] || d.hasBall) continue;
      const c = resetAbilityCtx(ACTX); c.what = 'intR'; c.t = w.time; c.log = null;
      let intR = d.attrs.catchR + INTERCEPT.R_ADD + add(d, 'steal', c);
      if (w.time - d.cx.lungeT <= INTERCEPT.LUNGE_T) intR += INTERCEPT.LUNGE_ADD;
      const dx = ball.pos.x - d.pos.x, dz = ball.pos.z - d.pos.z, dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > intR) continue;
      const top = d.attrs.catchTopY + (d.jumpY > 0 ? d.jumpY : 0);
      if (ball.pos.y < INTERCEPT.MIN_Y || ball.pos.y > top) continue;
      this.intRolled[d.idx] = 1;
      if (has(d, 'jordan.hawk')) { c.log = this.abilityLog; add(d, 'steal', c); }
      const pInt = interceptChance(d, dist, intR);
      const u = this.rng.next();
      if (u < pInt) { this.onCatch(d, 'intercept'); return; }
      if (this.rng.next() < INTERCEPT.DEFLECT_P) {
        const v = ball.vel;
        v.x *= INTERCEPT.DEFLECT_V; v.y *= INTERCEPT.DEFLECT_V; v.z *= INTERCEPT.DEFLECT_V;
        const side = this.rng.next() < 0.5 ? -1 : 1;
        const sl = Math.sqrt(v.x * v.x + v.z * v.z) || 1;
        v.x += -v.z / sl * INTERCEPT.DEFLECT_LATERAL * side; v.z += v.x / sl * INTERCEPT.DEFLECT_LATERAL * side;
        ball.state = 'loose'; ball.lastToucher = d; ball.ctx = 'pass'; ball.contacted = true;
        this.metrics.deflect(from.team);
        const e = this.ev('deflect', d); e.fromId = from.id; this.fire(e);
        return;
      }
    }
  }

  /** Box-outs at a shot (§5.6): CPU defenders within 2.0 m of their man roll tend.boxOut → 0.4 s. */
  rollBoxOuts(shooter) {
    for (let i = 0; i < 6; i++) {
      const d = this.players[i];
      if (d.team === shooter.team || this.isUserControlled(d) || !d.defAssign) continue;
      const m = d.defAssign, dx = m.pos.x - d.pos.x, dz = m.pos.z - d.pos.z;
      if (dx * dx + dz * dz > REBOUND.BOX_R * REBOUND.BOX_R) continue;
      if (this.rng.next() < d.legend.tend.boxOut) { d.boxT = REBOUND.BOX_T; d.boxing = m; }
    }
  }

}
