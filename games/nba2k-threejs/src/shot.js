// Shot mechanic: classification, contest, make probability and target steering (spec section 4).
//
// `world` is { players, ball, offense, rimXZ: {x, z} }; a player exposes pos {x,y,z}, team (0|1),
// isJumping, sprintedRecently, stamina, vel and data { dunk, shooting, defense }. Nothing here
// allocates: contestFactor and chooseTarget write into module-level result objects unless an `out`
// is supplied, so callers copy the fields before the next call.
import { RIM, BALL, SHOT, MOVE, DIFFICULTY, isThree } from './constants.js';
import { TAU, clamp, lerp } from './math.js';

const DEFAULT_G = DIFFICULTY.normal.userGreen;
const MAKE_DISC = 0.05;                          // uniform disc around the rim centre for a made jumper
const MAKE_DISC_LAYUP = 0.04;
const SHORT_MIN = 0.3, SHORT_SPAN = 0.8;         // early miss: RIM - fwd*(RIM.r + R*(0.3 + 0.8*rng))
const LONG_MIN = 0.3, LONG_SPAN = 0.6;           // late miss:  RIM + fwd*(RIM.r + R*(0.3 + 0.6*rng))
const AIRBALL_SHORT = 0.45;                      // e < -0.32: RIM - fwd*0.45 (usually misses the rim)
const LAYUP_MISS = 0.6;                          // layup miss: RIM - fwd*(RIM.r + R*0.6)
const SIDE_BASE = 0.05, SIDE_CONTEST = 0.25;     // side error = (0.05 + 0.25*(1 - C)) * rng[-1, 1]

const CONTEST = { C: 1, defender: null };
const TARGET = { x: 0, y: 0, z: 0 };

function rimOf(world) {
  return world && world.rimXZ ? world.rimXZ : RIM;
}

function ratingOf(player, key, fallback) {
  const data = player.data;
  const v = data && typeof data[key] === 'number' ? data[key] : player[key];
  return typeof v === 'number' ? v : fallback;
}

// Planar distance from point (px, pz) to the segment a -> b.
function segmentDist(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const len2 = abx * abx + abz * abz;
  let t = len2 > 1e-9 ? ((px - ax) * abx + (pz - az) * abz) / len2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + abx * t - px, cz = az + abz * t - pz;
  return Math.sqrt(cx * cx + cz * cz);
}

// Planar distance from the shooter's feet to the rim.
export function shotDistance(player, world) {
  const rim = rimOf(world);
  return Math.hypot(player.pos.x - rim.x, player.pos.z - rim.z);
}

// True when no opponent stands within SHOT.DUNK_LANE_R of the segment player -> rim.
export function dunkLaneClear(player, world) {
  const rim = rimOf(world);
  const players = world.players;
  for (let i = 0; i < players.length; i++) {
    const o = players[i];
    if (o === player || o.team === player.team) continue;
    if (segmentDist(o.pos.x, o.pos.z, player.pos.x, player.pos.z, rim.x, rim.z) < SHOT.DUNK_LANE_R) return false;
  }
  return true;
}

// Section 4.1: 'dunk' | 'layup' | 'three' | 'jumper', decided at press from the shooter's feet.
export function classifyShot(player, world) {
  const d = shotDistance(player, world);
  if (d <= SHOT.LAYUP_D) {
    if (player.sprintedRecently && ratingOf(player, 'dunk', 0) >= SHOT.DUNK_MIN && dunkLaneClear(player, world)) return 'dunk';
    return 'layup';
  }
  return isThree(player.pos.x, player.pos.z) ? 'three' : 'jumper';
}

// Section 4.3 contest: the nearest opponent in front of the shooter (dot with the shooter->rim
// direction > 0.3) sets C from its distance; a jumping defender contests harder. The defender's
// `defense` rating shrinks the measured distance (section 13). Writes { C, defender } into out.
export function contestFactor(shooter, world, out = CONTEST) {
  const rim = rimOf(world);
  const sx = shooter.pos.x, sz = shooter.pos.z;
  let fx = rim.x - sx, fz = rim.z - sz;
  const fl = Math.sqrt(fx * fx + fz * fz);
  if (fl > 1e-9) { fx /= fl; fz /= fl; } else { fx = 0; fz = -1; }
  const players = world.players;
  let best = null, bestD = Infinity;
  for (let i = 0; i < players.length; i++) {
    const o = players[i];
    if (o === shooter || o.team === shooter.team) continue;
    const dx = o.pos.x - sx, dz = o.pos.z - sz;
    const dd = Math.sqrt(dx * dx + dz * dz);
    if (dd > 1e-6 && (dx * fx + dz * fz) / dd <= SHOT.CONTEST_DOT) continue;
    if (dd < bestD) { bestD = dd; best = o; }
  }
  let C = 1;
  if (best) {
    const dd = bestD / Math.max(0.5, ratingOf(best, 'defense', 1));
    if (dd >= SHOT.CONTEST_FAR) C = 1;
    else if (dd <= SHOT.CONTEST_NEAR) C = SHOT.CONTEST_MIN;
    else C = lerp(SHOT.CONTEST_MIN, 1, (dd - SHOT.CONTEST_NEAR) / (SHOT.CONTEST_FAR - SHOT.CONTEST_NEAR));
    if (best.isJumping) C *= SHOT.CONTEST_JUMP_MUL;
  }
  out.C = C;
  out.defender = best;
  return out;
}

// Section 4.3 base(d) by distance from the rim.
export function baseProbability(d) {
  if (d <= 1.5) return 0.92;
  if (d <= 4) return lerp(0.85, 0.62, (d - 1.5) / 2.5);
  if (d <= 6.75) return lerp(0.62, 0.50, (d - 4) / 2.75);
  if (d <= 8) return lerp(0.50, 0.40, (d - 6.75) / 1.25);
  return Math.max(0.10, 0.40 - 0.08 * (d - 8));
}

// Green half-width for a shot kind: layups widen the difficulty's window by 0.04.
export function greenHalfWidth(kind, g = DEFAULT_G) {
  return kind === 'layup' ? g + SHOT.LAYUP_G_BONUS : g;
}

// Section 4.3 timing(e): 1.60 inside the green window, falling to 0.30 at |e| = 0.30, 0.20 beyond.
export function timingFactor(e, g = DEFAULT_G) {
  const a = Math.abs(e);
  if (a <= g) return SHOT.TIMING_GREEN;
  if (a > SHOT.TIMING_MAX_E) return SHOT.TIMING_BAD;
  const span = SHOT.TIMING_MAX_E - g;
  if (span <= 1e-9) return SHOT.TIMING_EDGE;
  return lerp(SHOT.TIMING_GREEN, SHOT.TIMING_EDGE, (a - g) / span);
}

// Section 4.3: p = clamp(base * timing * C * fatigue * move * rating, 0.02, 0.97).
// `g` is the difficulty's green half-width (layups widen it here); `speed` is the horizontal speed
// at release. Dunks always go in; layups use base(d) with d clamped to >= 1.0 and skip the move penalty.
export function makeProbability(kind, d, e, C, stamina = 1, speed = 0, rating = 1, g = DEFAULT_G) {
  if (kind === 'dunk') return 1;
  const layup = kind === 'layup';
  const dd = layup ? Math.max(d, SHOT.LAYUP_MIN_D) : d;
  let p = baseProbability(dd) * timingFactor(e, greenHalfWidth(kind, g)) * C;
  if (stamina < MOVE.STAMINA_TIRED) p *= SHOT.FATIGUE_MUL;
  if (!layup && speed > SHOT.MOVE_SPEED) p *= SHOT.MOVE_MUL;
  p *= rating;
  return clamp(p, SHOT.P_MIN, SHOT.P_MAX);
}

// Section 4.4: the xz point (at rim height) the arc is aimed at. Makes land on a small disc around
// the rim centre; early misses fall short of the front rim (air ball when e < -0.32), late misses
// carry to the back rim, and a miss inside the green window (`g`) is treated as late. A lateral
// error that grows with the contest is added to every miss. Writes { x, y, z } into out.
export function chooseTarget(make, e, C, kind, shooterXZ, rng, out = TARGET, g = DEFAULT_G) {
  let fx = RIM.x - shooterXZ.x, fz = RIM.z - shooterXZ.z;
  const fl = Math.sqrt(fx * fx + fz * fz);
  if (fl > 1e-9) { fx /= fl; fz /= fl; } else { fx = 0; fz = -1; }
  out.y = RIM.y;
  if (kind === 'dunk') { out.x = RIM.x; out.z = RIM.z; return out; }
  if (make) {
    const radius = (kind === 'layup' ? MAKE_DISC_LAYUP : MAKE_DISC) * Math.sqrt(rng.next());
    const a = TAU * rng.next();
    out.x = RIM.x + radius * Math.cos(a);
    out.z = RIM.z + radius * Math.sin(a);
    return out;
  }
  // Signed distance along fwd from the rim centre (negative = short).
  let along;
  if (kind === 'layup') {
    along = -(RIM.r + BALL.R * LAYUP_MISS);
  } else if (e < SHOT.AIRBALL_E) {
    along = -AIRBALL_SHORT;
  } else if (e < -Math.abs(g)) {
    along = -(RIM.r + BALL.R * (SHORT_MIN + SHORT_SPAN * rng.next()));
  } else {
    along = RIM.r + BALL.R * (LONG_MIN + LONG_SPAN * rng.next());
  }
  const side = (SIDE_BASE + SIDE_CONTEST * (1 - C)) * rng.range(-1, 1);
  // side = perp(fwd) = (-fz, fx)
  out.x = RIM.x + fx * along - fz * side;
  out.z = RIM.z + fz * along + fx * side;
  return out;
}

// Section 4.2: meter fill time by shot kind (layups and dunks use the short meter).
export function meterDuration(kind) {
  return kind === 'layup' || kind === 'dunk' ? SHOT.METER_T_LAYUP : SHOT.METER_T;
}
