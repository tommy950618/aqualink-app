/**
 * @module shot
 * Shooting model v2 (spec §5.3, D-GP-2/3/5, C1): rating zone, points at release, green-open probability `Pg`,
 * shot-type multipliers, per-player timing (`eT` in seconds, green half-width `gS`), the geometric contest
 * (`X`, `C`), the make probability, and the miss / air-ball targets. Signature abilities enter through
 * `abilities.js` hooks (`pg`, `contestA`, `clutch`) and rule helpers (contest range, fixed make).
 *
 * Shapes read here:
 * - Player: `id` (legend id) or `legend`, `team`, `pos {x, z}`, `jumpY`, `isJumping`, `state` ('stunned' | 'fallen'
 *   disable a contester), `stamina`, `defAssign`.
 * - World: `{ players: Player[] }`.
 *
 * Zero allocation per call: every function writes into module-level scratch results (or a caller-supplied `out`);
 * callers copy the fields they keep before the next call. Nothing here draws random numbers except `chooseTarget` /
 * `airBallTarget` / `cpuReleaseError`, which take the gameplay `Rng`.
 */
import { RIM, BALL, SHOT_V2, DIFFICULTY, isThree } from './constants.js';
import { n, zoneRating } from './ratings.js';
import {
  legendOf, mul, contestRange, fixedMake, noteApplied, has, makeAbilityCtx, resetAbilityCtx, frontDot,
} from './abilities.js';

const S = SHOT_V2;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Jump-shot families: points by the feet at release (3 beyond the arc). */
const JUMP_SHOTS = { jumper: true, fade: true, stepback: true, turnFade: true, hook: true, floater: true };
/** Jumper family: movement penalty M, block window 0.22 s, CAP 0.30. */
const JUMPER_FAMILY = { jumper: true, fade: true, stepback: true, turnFade: true };
/** Kinds whose M uses only the velocity component toward the rim. */
const DRIFT_KINDS = { fade: true, stepback: true, turnFade: true };

/** True for jump-shot kinds (jumper, fade, stepback, turnFade, hook, floater). */
export function isJumpShot(kind) {
  return JUMP_SHOTS[kind] === true;
}

/** True for the jumper family (jumper, fade, stepback, turnFade). */
export function isJumperFamily(kind) {
  return JUMPER_FAMILY[kind] === true;
}

/** Horizontal distance from (x, z) to the rim centre. */
export function shotDistance(x, z) {
  const dx = x - RIM.x, dz = z - RIM.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Rating zone of a shot (§5.3.1) from the kind and the feet (x, z) at release (d = their distance to the rim):
 * layup → 'layup'; dunk → 'dunk'; hook / floater / tip → 'close'; jump shots → 'three' if isThree(x, z), else
 * 'close' if d ≤ 3.5, else 'mid'.
 */
export function resolveShotZone(kind, d, x, z) {
  if (kind === 'layup') return 'layup';
  if (kind === 'dunk') return 'dunk';
  if (kind === 'hook' || kind === 'floater' || kind === 'tip') return 'close';
  if (isThree(x, z)) return 'three';
  return d <= S.CLOSE_D ? 'close' : 'mid';
}

/** Points of a shot (§5.3.5, C1): jump shots 3 when the feet at the release step are beyond the arc; else 2. */
export function shotPoints(kind, x, z) {
  return JUMP_SHOTS[kind] && isThree(x, z) ? 3 : 2;
}

/**
 * Green-open make probability `Pg` (§5.3.3) for a rating zone at distance d (feet → rim, metres).
 * @param {'dunk'|'layup'|'close'|'mid'|'three'} zone
 * @param {number} d
 * @param {object} ratings the shooter's `LEGENDS[id].ratings`
 */
export function pg(zone, d, ratings) {
  const P = S.PG;
  switch (zone) {
    case 'dunk': return P.dunk[0] + P.dunk[1] * n(ratings.dunk);
    case 'layup': return P.layup[0] + P.layup[1] * n(ratings.layup);
    case 'close': return (P.close[0] + P.close[1] * n(ratings.closeShot)) * (1 - P.CLOSE_K * Math.max(0, d - P.CLOSE_D0));
    case 'mid': return (P.mid[0] + P.mid[1] * n(ratings.midRange)) * (1 - P.MID_K * (d - P.MID_D0));
    case 'three': {
      // Deep threes lose 12 % per metre beyond 7.8 m, floored at 20 % of the base.
      const far = d <= P.THREE_D0 ? 1 : Math.max(P.THREE_MIN, 1 - P.THREE_K * (d - P.THREE_D0));
      return (P.three[0] + P.three[1] * n(ratings.three)) * far;
    }
    default: return 0;
  }
}

/**
 * Generic shot-type multiplier on `Pg` (§5.3.3; legend-agnostic — Yao's hook / up-and-under, Jordan's fades,
 * Kobe's post fade, Kyrie's stepback and floater override it through the `pg` ability hook).
 */
export function typeMul(kind, variant) {
  const T = S.TYPE_MUL;
  if (kind === 'layup') {
    const v = T.layup[variant];
    return v === undefined ? 1 : v;
  }
  const v = T[kind];
  return typeof v === 'number' ? v : 1;
}

/** Generic shot-type contest multiplier in `A` (§5.3.6); euro handles its dodged defender by exclusion. */
export function contestA(kind, variant) {
  const T = S.CONTEST_A;
  if (kind === 'layup') {
    const v = T.layup[variant];
    return v === undefined ? 1 : v;
  }
  const v = T[kind];
  return typeof v === 'number' ? v : 1;
}

/**
 * Green half-width `gS` in seconds (§5.3.2): `G_DIFF × (0.80 + 0.40·n(zoneRating))`, layups + 0.022 s; dunks and
 * tips have no meter (0). `gDiff` = DIFFICULTY[d].userGreen for the human, the normal value for CPU shooters.
 */
export function greenHalfWidth(zoneRatingValue, gDiff, kind) {
  if (kind === 'dunk' || kind === 'tip') return 0;
  const g = gDiff * (S.G_RATING_BASE + S.G_RATING_K * n(zoneRatingValue));
  return kind === 'layup' ? g + S.LAYUP_G_ADD : g;
}

/**
 * Timing factor `T(eT)` (§5.3.2): 1.00 inside the green (|eT| ≤ gS), then linear from 0.80 at the green edge to 0.22
 * at |eT| = 0.165 s, 0.12 beyond.
 */
export function timingFactor(eT, gS) {
  const a = Math.abs(eT);
  if (a <= gS) return S.T_GREEN;
  if (a > S.T_EDGE) return S.T_BAD;
  const span = S.T_EDGE - gS;
  if (span <= 1e-9) return S.T_EDGE_LO;
  return S.T_EDGE_HI + (S.T_EDGE_LO - S.T_EDGE_HI) * ((a - gS) / span);
}

/** Air ball (§5.3.2): eT ≤ −0.175 s (released far too early) is a forced miss with the air-ball target. */
export function isAirball(eT) {
  return eT <= S.AIRBALL_ET;
}

/** Meter fraction error `e = eT / METER_T` (flash, `debugShoot({e})`). */
export function eFromET(eT, meterT) {
  return meterT > 0 ? eT / meterT : 0;
}

/** Inverse of `eFromET`. */
export function eTFromE(e, meterT) {
  return e * meterT;
}

const BAND = { lo: 0, hi: 0 };

/** Meter green band (§5.3.2) as fractions of the bar: `[0.80 − gS/METER_T, 0.80 + gS/METER_T]`. */
export function meterBand(gS, meterT, out = BAND) {
  const h = meterT > 0 ? gS / meterT : 0;
  out.lo = S.METER_IDEAL - h;
  out.hi = S.METER_IDEAL + h;
  return out;
}

/** CPU release error `eT_cpu ~ N(0, σ)` clamped to [−0.25, +0.22] s (§5.3.2). */
export function cpuReleaseError(rng, sigma) {
  return clamp(rng.gauss(0, sigma), S.CPU_ET_MIN, S.CPU_ET_MAX);
}

/** Fatigue factor F (§5.3.4): 0.92 below 30 % stamina. */
export function fatigueFactor(stamina) {
  return stamina < S.FATIGUE_STAMINA ? S.FATIGUE_MUL : 1;
}

/**
 * Movement factor M (§5.3.4), jumper family only: v = root speed at TAKEOFF (fade / stepback / turnFade: only the
 * velocity component toward the rim, from the feet (x, z)); `v > 2.5 ? max(0.80, 1 − 0.07·(v − 2.5)) : 1`.
 */
export function movementFactor(kind, vx, vz, x, z) {
  if (!JUMPER_FAMILY[kind]) return 1;
  let v;
  if (DRIFT_KINDS[kind]) {
    const dx = RIM.x - x, dz = RIM.z - z;
    const dl = Math.sqrt(dx * dx + dz * dz);
    v = dl > 1e-9 ? (vx * dx + vz * dz) / dl : 0;
  } else {
    v = Math.sqrt(vx * vx + vz * vz);
  }
  return v > S.MOVE_V ? Math.max(S.MOVE_MIN, 1 - S.MOVE_K * (v - S.MOVE_V)) : 1;
}

/**
 * Difficulty make multiplier (§5.3.4) by who shoots: 'human' → userMakeMul, 'cpu' (CPU opponent of the human) →
 * cpuMakeMul, 'mate' (the human's CPU teammate) and 'auto' (CPU-vs-CPU game) → 1.00.
 */
export function diffMul(side, difficulty) {
  const D = DIFFICULTY[difficulty] || DIFFICULTY.normal;
  if (side === 'human') return D.userMakeMul;
  if (side === 'cpu') return D.cpuMakeMul;
  return 1;
}

/** G_DIFF for a shooter: the chosen difficulty for the human, `normal` for every CPU shooter (§5.3.2). */
export function gDiffFor(side, difficulty) {
  return side === 'human' ? (S.G_DIFF[difficulty] || S.G_DIFF.normal) : S.G_DIFF.normal;
}

/**
 * Make probability (§5.3.4): `clamp(Pg × typeMul × T × C × F × M × K × diffMul, 0.02, dunk ? 0.995 : 0.97)`.
 * `pgTyped` = Pg × the effective type multiplier (abilities included).
 */
export function makeProbability(kind, pgTyped, T, C, F, M, K, dMul) {
  return clamp(pgTyped * T * C * F * M * K * dMul, S.P_MIN, kind === 'dunk' ? S.P_MAX_DUNK : S.P_MAX);
}

// --------------------------------------------------------------------------------------------------------------------
// Contest (§5.3.6)
// --------------------------------------------------------------------------------------------------------------------

function disabled(p) {
  return p.state === 'stunned' || p.state === 'fallen';
}

/**
 * Release height used for `Kh` (§5.3.6): jumper / stepback → release.jumper; fade / turnFade → release.fade; hook →
 * release.hook (release.jumper for a legend without a hook entry); layup = reachM + 0.15 + jumpY; dunk 3.23;
 * floater = reachM + 0.10 + jumpY; tip = reachM + jumpY.
 */
export function releaseHeight(shooter, kind) {
  const L = legendOf(shooter);
  const jy = shooter.jumpY || 0;
  const reach = L ? L.stats.reachM : 2.6;
  const rel = L ? L.release : null;
  switch (kind) {
    case 'fade': case 'turnFade': return rel ? rel.fade : reach + 0.3;
    case 'hook': return rel ? (rel.hook !== null && rel.hook !== undefined ? rel.hook : rel.jumper) : reach + 0.3;
    case 'layup': return reach + S.LAYUP_REL_ADD + jy;
    case 'dunk': return S.DUNK_REL_Y;
    case 'floater': return reach + S.FLOATER_REL_ADD + jy;
    case 'tip': return reach + jy;
    default: return rel ? rel.jumper : reach + 0.3;
  }
}

/**
 * The defender who makes contact at takeoff (§5.3.6 contact rule): the nearest active opponent within 0.80 m in
 * front of the shooter (dot ≥ 0.20). Call at TAKEOFF and pass the result as `opts.contactDef` at release.
 */
export function findContactDefender(shooter, world) {
  const players = world && world.players;
  if (!players) return null;
  let best = null, bestD = S.CONTACT_R;
  for (let i = 0; i < players.length; i++) {
    const o = players[i];
    if (o === shooter || o.team === shooter.team || disabled(o)) continue;
    const dx = o.pos.x - shooter.pos.x, dz = o.pos.z - shooter.pos.z;
    const dd = Math.sqrt(dx * dx + dz * dz);
    if (dd > bestD) continue;
    if (frontDot(shooter, o) < S.FRONT_DOT) continue;
    best = o; bestD = dd;
  }
  return best;
}

/**
 * Options of a contest / shot evaluation; one reusable object per call site (`makeShotInput()`), fields:
 * - `kind`, `variant`, `x`, `z` (feet at release; NaN → the shooter's position), `eT` (s, NaN = no meter input),
 * - `side` ('human' | 'cpu' | 'mate' | 'auto'), `difficulty` ('easy' | 'normal' | 'hard'),
 * - `estimate` (AI estimate: T = T̄_cpu, no green, nothing logged), `green` (contest only: force the green flag),
 * - `stamina` (NaN → shooter.stamina), `takeoffVx`, `takeoffVz` (root velocity at TAKEOFF),
 * - `quarter`, `gameClock`, `scoreDiff` (shooter's team minus the opponent), `t`, `log` (AbilityLog | null),
 * - `sinceBumpWon` (s since LeBron won a drive bump), `sagA` (jab-bite sag factor, 0.5 within 0.8 s, else 1),
 * - `excluded` (the defender dodged by a euro step), `contactDef` (the takeoff contact defender; undefined → computed
 *   now), `forcedP` (debugShoot `p`; NaN = none).
 */
export function makeShotInput() {
  return resetShotInput({});
}

/** Reset a shot input to its defaults (no allocation). */
export function resetShotInput(o) {
  o.kind = 'jumper'; o.variant = null; o.x = NaN; o.z = NaN; o.eT = NaN;
  o.side = 'auto'; o.difficulty = 'normal'; o.estimate = false; o.green = false;
  o.stamina = NaN; o.takeoffVx = 0; o.takeoffVz = 0;
  o.quarter = 1; o.gameClock = Infinity; o.scoreDiff = 0; o.t = 0; o.log = null;
  o.sinceBumpWon = Infinity; o.sagA = 1; o.excluded = null; o.contactDef = undefined; o.forcedP = NaN;
  return o;
}

const DEFAULT_INPUT = makeShotInput();
const ACTX = makeAbilityCtx();
const RANGE = { Rc: 0, deter: 0, id: null };
const CONTEST = { C: 1, X: 0, Xraw: 0, defender: null, parts: { Kd: 0, Kh: 0, Ks: 0 }, A: 1, contact: 1, contactDef: null, zone: null, green: false };

function fillAbilityCtx(c, shooter, kind, variant, zone, d, o) {
  resetAbilityCtx(c);
  c.t = o.t; c.log = o.estimate ? null : o.log; c.world = null;
  c.kind = kind; c.variant = variant; c.zone = zone; c.d = d;
  c.quarter = o.quarter; c.gameClock = o.gameClock; c.scoreDiff = o.scoreDiff;
  c.sinceBumpWon = o.sinceBumpWon; c.shooter = shooter;
  return c;
}

/**
 * Contest of a shot at the release step (§5.3.6). For each active opponent i (not stunned / fallen, not the euro-
 * dodged defender): `X_i = front_i ? Kd·Kh·Ks : 0`; `Xraw = max + 0.35·second + deter`;
 * `X = clamp(Xraw × max(0.35, A) × (green ? 0.65 : 1), 0, 1)`; `C = 1 − CMAX[zone]·X`, then the strength contact
 * factor for layup / close / dunk. Writes `{C, X, Xraw, defender, parts: {Kd, Kh, Ks}, A, contact, contactDef, zone,
 * green}` into `out` (module scratch by default) and returns it.
 * @param {object} shooter
 * @param {{players: object[]}} world
 * @param {string} kind
 * @param {object} [opts] a shot input (`makeShotInput()`); `green` decides the green factor
 */
export function contestFactor(shooter, world, kind, opts = DEFAULT_INPUT, out = CONTEST) {
  const o = opts;
  const variant = o.variant;
  const x = Number.isNaN(o.x) ? shooter.pos.x : o.x;
  const z = Number.isNaN(o.z) ? shooter.pos.z : o.z;
  const d = shotDistance(x, z);
  const zone = resolveShotZone(kind, d, x, z);
  const L = legendOf(shooter);
  const c = fillAbilityCtx(ACTX, shooter, kind, variant, zone, d, o);

  // Contest product A: generic shot-type multiplier × shooter abilities (override ratios / plain factors) × sag.
  const genericA = contestA(kind, variant);
  c.generic = genericA;
  const A = genericA * mul(shooter, 'contestA', c) * o.sagA;

  const relY = releaseHeight(shooter, kind);
  const perimeter = zone === 'mid' || zone === 'three';
  const rimX = RIM.x - x, rimZ = RIM.z - z;
  const rimL = Math.sqrt(rimX * rimX + rimZ * rimZ);
  let x1 = 0, x2 = 0, deter = 0, best = null, bKd = 0, bKh = 0, bKs = 0;
  const players = world && world.players ? world.players : null;
  const n0 = players ? players.length : 0;
  for (let i = 0; i < n0; i++) {
    const q = players[i];
    if (q === shooter || q.team === shooter.team || disabled(q) || q === o.excluded) continue;
    const dx = q.pos.x - x, dz = q.pos.z - z;
    const dd = Math.sqrt(dx * dx + dz * dz);
    // front: inside ±78° of the shooter→rim direction (dot ≥ 0.20), or close enough (≤ 0.90 m) that a side contest counts.
    const dot = dd > 1e-9 && rimL > 1e-9 ? (dx * rimX + dz * rimZ) / (dd * rimL) : 1;
    if (!(dot >= S.FRONT_DOT || dd <= S.FRONT_NEAR)) continue;
    contestRange(q, shooter, zone, c, RANGE);
    const Kd = clamp((RANGE.Rc - dd) / (RANGE.Rc - S.RC_INNER), 0, 1);
    if (Kd <= 0) continue;
    const Lq = legendOf(q);
    const handY = Lq.stats.reachM + (q.isJumping ? (q.jumpY || 0) : S.HANDS_UP_DY);
    const Kh = clamp(S.KH_BASE + (handY - relY) / S.KH_DIV, S.KH_MIN, S.KH_MAX);
    const Ks = S.KS_BASE + S.KS_K * n(perimeter ? Lq.ratings.perimeterD : Lq.ratings.interiorD);
    const Xi = Kd * Kh * Ks;
    if (RANGE.id) {
      noteApplied(c, RANGE.id, q, 'contestA');
      if (RANGE.deter > deter) deter = RANGE.deter;
    }
    if (Xi > x1) { x2 = x1; x1 = Xi; best = q; bKd = Kd; bKh = Kh; bKs = Ks; } else if (Xi > x2) x2 = Xi;
  }
  // Yao's raised release changes every contest of his jump shots (logged once per shot when someone contests).
  if (x1 > 0 && L && has(shooter, 'yao.highRelease') && (JUMPER_FAMILY[kind] || kind === 'hook')) noteApplied(c, 'yao.highRelease', shooter, 'contestA');

  const Xraw = x1 + S.SECOND_W * x2 + deter;
  const green = o.estimate ? false : o.green;
  const X = clamp(Xraw * Math.max(S.A_FLOOR, A) * (green ? S.GREEN_X : 1), 0, 1);
  let C = 1 - S.CMAX[zone] * X;

  // Strength contact (layup / close / dunk): a defender within 0.80 m in front at takeoff.
  let contact = 1;
  let cDef = null;
  if (zone === 'layup' || zone === 'close' || zone === 'dunk') {
    cDef = o.contactDef === undefined ? findContactDefender(shooter, world) : o.contactDef;
    const power = (kind === 'layup' || kind === 'dunk') && o.sinceBumpWon <= 0.8 && has(shooter, 'lebron.powerDrive');
    if (cDef && !disabled(cDef) && cDef !== o.excluded && !power) {
      const Ld = legendOf(cDef);
      contact = clamp(S.CONTACT_BASE + S.CONTACT_K * (L.ratings.strength - Ld.ratings.strength), S.CONTACT_MIN, S.CONTACT_MAX);
      C *= contact;
    }
  }

  out.C = C; out.X = X; out.Xraw = Xraw; out.defender = best;
  out.parts.Kd = bKd; out.parts.Kh = bKh; out.parts.Ks = bKs;
  out.A = A; out.contact = contact; out.contactDef = cDef; out.zone = zone; out.green = green;
  return out;
}

// --------------------------------------------------------------------------------------------------------------------
// Full evaluation at release (§5.3.2–§5.3.6)
// --------------------------------------------------------------------------------------------------------------------

const RESULT = {
  kind: null, variant: null, zone: null, d: 0, x: 0, z: 0, points: 2,
  pg: 0, typeMul: 1, pgTyped: 0, gS: 0, T: 1, green: false, airball: false, eT: NaN,
  C: 1, X: 0, Xraw: 0, A: 1, contact: 1, defender: null, contactDef: null, parts: { Kd: 0, Kh: 0, Ks: 0 },
  F: 1, M: 1, K: 1, diffMul: 1, fixed: false, p: 0,
};

/**
 * Everything the release step needs for one shot (§5.3): zone, points, Pg × typeMul (abilities included), gS,
 * timing T (dunk 1, tip 0.85, estimate T̄_cpu), green, air ball, contest, F, M, K (clutch), diffMul, and the make
 * probability p (0 for a forced air ball; Jordan's FT-line dunk 0.97; `forcedP` wins). Writes into `out`.
 * The caller rolls `rng.next() < p` once (v1) unless `airball`.
 */
export function evaluateShot(shooter, world, input, out = RESULT) {
  const o = input || DEFAULT_INPUT;
  const kind = o.kind, variant = o.variant;
  const L = legendOf(shooter);
  const x = Number.isNaN(o.x) ? shooter.pos.x : o.x;
  const z = Number.isNaN(o.z) ? shooter.pos.z : o.z;
  const d = shotDistance(x, z);
  const zone = resolveShotZone(kind, d, x, z);
  const c = fillAbilityCtx(ACTX, shooter, kind, variant, zone, d, o);

  // Pg × type multiplier; the `pg` hook returns override / generic ratios (Yao hook, Jordan fade, Giannis 0.99, …).
  const pgv = pg(zone, d, L.ratings);
  const tm = typeMul(kind, variant);
  c.generic = tm;
  c.pg = pgv * tm;
  const pgTyped = pgv * tm * mul(shooter, 'pg', c);

  // Timing.
  const diffId = o.side === 'cpu' ? o.difficulty : (o.side === 'human' ? o.difficulty : 'normal');
  const gS = greenHalfWidth(zoneRating(L.ratings, zone), gDiffFor(o.side, o.difficulty), kind);
  let T, green = false, airball = false;
  if (kind === 'dunk') T = 1;
  else if (kind === 'tip') T = S.TIP_T;
  else if (o.estimate) T = S.CPU_TBAR[diffId] || S.CPU_TBAR.normal;
  else if (Number.isNaN(o.eT)) T = 1;
  else {
    T = timingFactor(o.eT, gS);
    green = Math.abs(o.eT) <= gS;
    airball = isAirball(o.eT);
  }

  // Contest with the green flag of this release.
  const saveGreen = o.green;
  o.green = green;
  const ct = contestFactor(shooter, world, kind, o, CONTEST);
  o.green = saveGreen;

  const F = fatigueFactor(Number.isNaN(o.stamina) ? (shooter.stamina === undefined ? 1 : shooter.stamina) : o.stamina);
  const M = movementFactor(kind, o.takeoffVx, o.takeoffVz, x, z);
  fillAbilityCtx(ACTX, shooter, kind, variant, zone, d, o);
  const K = mul(shooter, 'clutch', ACTX);
  const dm = diffMul(o.side, o.difficulty);

  let p;
  const fixedP = fixedMake(shooter, ACTX);   // logs only when ACTX.log is set (never for estimates)
  out.fixed = false;
  if (!Number.isNaN(o.forcedP)) p = o.forcedP;
  else if (airball) p = 0;
  else if (fixedP >= 0) { p = fixedP; out.fixed = true; }
  else p = makeProbability(kind, pgTyped, T, ct.C, F, M, K, dm);

  out.kind = kind; out.variant = variant; out.zone = zone; out.d = d; out.x = x; out.z = z;
  out.points = shotPoints(kind, x, z);
  out.pg = pgv; out.typeMul = pgv > 0 ? pgTyped / pgv : tm; out.pgTyped = pgTyped;
  out.gS = gS; out.T = T; out.green = green; out.airball = airball; out.eT = o.eT;
  out.C = ct.C; out.X = ct.X; out.Xraw = ct.Xraw; out.A = ct.A; out.contact = ct.contact;
  out.defender = ct.defender; out.contactDef = ct.contactDef;
  out.parts.Kd = ct.parts.Kd; out.parts.Kh = ct.parts.Kh; out.parts.Ks = ct.parts.Ks;
  out.F = F; out.M = M; out.K = K; out.diffMul = dm; out.p = p;
  return out;
}

// --------------------------------------------------------------------------------------------------------------------
// Targets (§5.3.7, v1 §4.4)
// --------------------------------------------------------------------------------------------------------------------

const TARGET = { x: 0, y: 0, z: 0, airball: false };

function rimDir(sx, sz, out) {
  let fx = RIM.x - sx, fz = RIM.z - sz;
  const fl = Math.sqrt(fx * fx + fz * fz);
  if (fl > 1e-9) { fx /= fl; fz /= fl; } else { fx = 0; fz = -1; }
  out.x = fx; out.z = fz;
  return out;
}

const DIR = { x: 0, z: 0 };

/**
 * Air-ball target (§5.3.7, R#30): `along = −(0.50 + 0.30·rng)` m from the rim centre (toward the shooter) at
 * `y = RIM.y − 0.55`, so the ball drops in front of the rim and never touches it.
 */
export function airBallTarget(sx, sz, rng, out = TARGET) {
  rimDir(sx, sz, DIR);
  const along = -(S.AIRBALL_ALONG_MIN + S.AIRBALL_ALONG_SPAN * rng.next());
  out.x = RIM.x + DIR.x * along;
  out.z = RIM.z + DIR.z * along;
  out.y = RIM.y + S.AIRBALL_DY;
  out.airball = true;
  return out;
}

/**
 * Aim point of a shot (v1 §4.4 with §5.3.7): dunks → the rim centre; makes → a small disc around the rim centre;
 * air balls (eT ≤ −0.175) → `airBallTarget`; layup misses → just short of the front rim; jump-shot misses short when
 * early (eT < −gS), long when late (eT > gS), and short or long with p 0.5 for a green miss or a shot without a meter
 * (eT NaN: tips). Every miss gets a lateral error `(0.05 + 0.25·(1 − C))·U(−1, 1)`. Writes `{x, y, z, airball}`.
 */
export function chooseTarget(make, eT, gS, kind, sx, sz, C, rng, out = TARGET) {
  out.airball = false;
  out.y = RIM.y;
  if (kind === 'dunk') { out.x = RIM.x; out.z = RIM.z; return out; }
  if (!make && !Number.isNaN(eT) && isAirball(eT) && kind !== 'tip') return airBallTarget(sx, sz, rng, out);
  rimDir(sx, sz, DIR);
  if (make) {
    // Uniform point in a disc: radius ∝ sqrt(U).
    const radius = (kind === 'layup' ? S.MAKE_DISC_LAYUP : S.MAKE_DISC) * Math.sqrt(rng.next());
    const a = Math.PI * 2 * rng.next();
    out.x = RIM.x + radius * Math.cos(a);
    out.z = RIM.z + radius * Math.sin(a);
    return out;
  }
  let along;
  if (kind === 'layup') along = -(RIM.r + BALL.R * S.LAYUP_MISS);
  else {
    // Green misses (and meterless tips) go short or long with p 0.5 (R#32); otherwise early = short, late = long.
    const isShort = Number.isNaN(eT) || Math.abs(eT) <= gS ? rng.next() < 0.5 : eT < 0;
    along = isShort ? -(RIM.r + BALL.R * (S.SHORT_MIN + S.SHORT_SPAN * rng.next()))
      : RIM.r + BALL.R * (S.LONG_MIN + S.LONG_SPAN * rng.next());
  }
  const side = (S.SIDE_BASE + S.SIDE_CONTEST * (1 - C)) * rng.range(-1, 1);
  // side axis = perp(dir) = (−dz, dx)
  out.x = RIM.x + DIR.x * along - DIR.z * side;
  out.z = RIM.z + DIR.z * along + DIR.x * side;
  return out;
}
