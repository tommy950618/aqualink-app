// Ball physics: pure functions over a ball-like object (spec sections 4.5, 5.1-5.5, 5.9, 5.14).
//
// A "ball-like" object exposes { pos, prevPos, vel, rimContacts, rimEnabled } where pos/vel are
// anything with numeric x/y/z fields (THREE.Vector3 or plain objects). Points passed to the solvers
// are plain { x, y, z }. Nothing here allocates in the per-step functions; the solvers write into the
// caller's `out` object or, when none is given, into a module-level object that the next call reuses.
import { RIM, BOARD, BALL, FIXED_DT } from './constants.js';
import { clamp } from './math.js';

const G = BALL.G;
const R = BALL.R;
const DRAG = BALL.DRAG;
const REACH_RIM = R + RIM.collideTube;          // centre distance at which the ball touches the rim tube
const TANGENT_RIM = 0.92;                        // tangential damping on a rim hit
const TANGENT_BOARD = 0.90;                      // tangential damping on a board hit
const RIM_JITTER = 0.05;                         // +-5 % speed jitter on a rim hit
const KICK_OUT_SPEED = 2.0;                      // horizontal speed used to eject a ball stuck on the rim
const KICK_OUT_VY = 0.5;
const SETTLE_IMPACT = 0.35;                      // a landing slower than this is a rolling ball, not a bounce
const REST_SPEED_SQ = BALL.REST_SPEED * BALL.REST_SPEED;
const PASS_SPEED = 12;                           // chest pass: T is shortened to dist / 12 ...
const PASS_MIN_T = 0.30;                         // ... but never below 0.30 s
const PASS_APEX = 0.25;
const LOB_APEX = 1.8;
const NEAR_RIM_SQ = BALL.NEAR_RIM_R * BALL.NEAR_RIM_R;

const ARC_OUT = { vx: 0, vy: 0, vz: 0, T: 0 };
const LAND_OUT = { x: 0, z: 0, t: 0 };
const STEP_OUT = { floor: 0, rim: 0, board: 0, scored: false };

// ---------------------------------------------------------------- integration

// Semi-implicit Euler with linear drag: v.y -= g dt; v *= (1 - DRAG dt); p += v dt.
export function integrateBall(ball, dt) {
  const v = ball.vel, p = ball.pos;
  v.y -= G * dt;
  const k = 1 - DRAG * dt;
  v.x *= k; v.y *= k; v.z *= k;
  p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
  return ball;
}

// True when the ball centre is inside the sub-stepping radius around the rim (section 5.1).
export function nearRim(pos) {
  const dx = pos.x - RIM.x, dy = pos.y - RIM.y, dz = pos.z - RIM.z;
  return dx * dx + dy * dy + dz * dz < NEAR_RIM_SQ;
}

// ---------------------------------------------------------------- collisions

// Floor (section 5.2). Returns the post-bounce |v.y| when the ball bounced, else 0.
// A landing slower than SETTLE_IMPACT is a rolling ball being pulled down by one gravity step; it is
// snapped back to the floor without friction or a bounce event. Rolling decay and resting use dt.
export function collideFloor(ball, dt = FIXED_DT) {
  const p = ball.pos, v = ball.vel;
  let impact = 0;
  if (p.y < R) {
    p.y = R;
    if (v.y < 0) {
      const vIn = -v.y;
      if (vIn > SETTLE_IMPACT) {
        v.y = vIn * BALL.REST_FLOOR;
        v.x *= BALL.FRICTION_FLOOR;
        v.z *= BALL.FRICTION_FLOOR;
        impact = v.y;
        if (v.y < BALL.SETTLE_VY) v.y = 0;
      } else {
        v.y = 0;
      }
    }
  }
  if (v.y === 0 && p.y <= R) {
    // Rolling: v.xz *= (1 - 2.5 dt); below 0.3 m/s the ball rests.
    const f = Math.max(0, 1 - BALL.ROLL_DECEL * dt);
    v.x *= f;
    v.z *= f;
    if (v.x * v.x + v.z * v.z < REST_SPEED_SQ) { v.x = 0; v.z = 0; }
  }
  return impact;
}

// Rim: sphere vs torus (section 5.3). Returns the normal impact speed |vn| on a bounce, else 0.
// Skipped while ball.rimEnabled === false. After more than MAX_RIM_CONTACTS hits in one flight the ball
// is kicked outward and rim collision is switched off for the rest of that flight.
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
  // Reflect the normal part with restitution and damp the tangential part.
  const e = BALL.REST_RIM;
  v.x = (v.x - vn * nx) * TANGENT_RIM - e * vn * nx;
  v.y = (v.y - vn * ny) * TANGENT_RIM - e * vn * ny;
  v.z = (v.z - vn * nz) * TANGENT_RIM - e * vn * nz;
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

// Backboard: sphere vs AABB (section 5.4). Returns |vn| on a hit, else 0.
// Skipped while ball.boardEnabled === false (a ball object without that field always collides).
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
  const e = BALL.REST_BOARD;
  v.x = (v.x - vn * nx) * TANGENT_BOARD - e * vn * nx;
  v.y = (v.y - vn * ny) * TANGENT_BOARD - e * vn * ny;
  v.z = (v.z - vn * nz) * TANGENT_BOARD - e * vn * nz;
  return -vn;
}

// Made-basket detector (section 5.5): the centre crossed the rim plane downward inside the cylinder
// of radius RIM.r - 0.6 R during this step. prevY is the centre height before the step.
export function testMadeBasket(prevY, ball) {
  const p = ball.pos;
  if (!(prevY > RIM.y && p.y <= RIM.y && ball.vel.y < 0)) return false;
  const dx = p.x - RIM.x, dz = p.z - RIM.z;
  return dx * dx + dz * dz < BALL.SCORE_R * BALL.SCORE_R;
}

// One free-ball step with the section 5.1 sub-stepping: near the rim the step runs as two half-steps,
// each followed by a full collision pass. out.{floor,rim,board} hold the strongest impact of each kind
// (0 when none) and out.scored is true if any sub-step satisfied testMadeBasket.
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

// Launch velocity that brings integrateBall from `from` to `to` in exactly N = round(T / FIXED_DT)
// steps. The spec's closed form assumes continuous motion; with semi-implicit Euler at 1/60 s plus
// drag the ball would land ~0.1 m low and ~0.06 m short over a 1.3 s arc, enough to miss the 0.157 m
// scoring cylinder. Inverting the discrete recurrence
//   v[n+1] = k (v[n] - g dt),  p[n+1] = p[n] + v[n+1] dt,  k = 1 - DRAG dt
// gives p[N] - p[0] = dt (N v* + (v0 - v*) S) with v* = -k g / DRAG and S = k (1 - k^N) / (1 - k).
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

// Section 4.5: apex apexAbove metres over the higher endpoint; T from the continuous arc, then the
// velocities are corrected for the integrator (see solveTimed). out = { vx, vy, vz, T }.
export function solveArc(from, to, apexAbove, g = G, out = ARC_OUT) {
  const apexY = Math.max(from.y, to.y) + apexAbove;
  const vy0 = Math.sqrt(2 * g * (apexY - from.y));
  const tUp = vy0 / g;
  const tDown = Math.sqrt(2 * (apexY - to.y) / g);
  return solveTimed(from, to, tUp + tDown, g, out);
}

// Section 4.5 apex table by shot distance.
export function apexForDistance(d) {
  if (d < 2) return 1.0;
  if (d < 5) return 1.6;
  if (d < 7.5) return 2.1;
  return 2.6;
}

// Section 5.9. Chest pass: a 0.25 m arc, shortened to T = max(dist/12, 0.30) when slower than that.
// Lob: a 1.8 m arc at its natural speed. `to` is the receiver's predicted chest point.
export function solvePass(from, to, lob, out = ARC_OUT) {
  if (lob) return solveArc(from, to, LOB_APEX, G, out);
  solveArc(from, to, PASS_APEX, G, out);
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  // Chest passes travel at the 12 m/s pace (T = max(dist/12, 0.30)) in both directions: a slow 0.25 m
  // arc is sped up per section 5.9, and a long one is held to that pace, because the natural arc over
  // 7 m leaves at 15 m/s, above the 14 m/s catch cap, and could never be caught (it flew out of bounds).
  const tFast = Math.max(dist / PASS_SPEED, PASS_MIN_T);
  if (Math.abs(out.T - tFast) > 1e-9) solveTimed(from, to, tFast, G, out);
  return out;
}

// Section 5.14: where the current parabola (no drag, no collisions) descends through y = targetY.
// Writes { x, z, t } into out and returns it, or null when the ball never comes down through targetY.
export function predictLanding(ball, targetY = 1.8, out = LAND_OUT) {
  const p = ball.pos, v = ball.vel;
  // 0.5 g t^2 - vy t + (targetY - y) = 0; the larger root is the descending crossing.
  const disc = v.y * v.y - 2 * G * (targetY - p.y);
  if (disc < 0) return null;
  const t = (v.y + Math.sqrt(disc)) / G;
  if (t <= 0) return null;
  out.x = p.x + v.x * t;
  out.z = p.z + v.z * t;
  out.t = t;
  return out;
}
