/**
 * @module ratings
 * Ratings → physical attributes (spec §5.1, D-GP-1). `derive(legend)` is pure, runs once per player at load and its
 * frozen result lives on `player.attrs`; nothing else reads raw ratings except the make / contest / block / steal
 * formulas, which all use the same normaliser `n(r)`.
 *
 * Notation: `n(r) = clamp((r − 25)/74, 0, 1)`; H listed height, W weight, ws wingspan; `w̃ = clamp((W − 88)/53, 0, 1)`.
 */

const G = 9.81;

/** Clamp v into [lo, hi]. */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Rating normaliser (§5.1): 25 → 0, 99 → 1. */
export function n(r) {
  return clamp((r - 25) / 74, 0, 1);
}

/** Weight factor used by the jump and stamina formulas: 0 at ≤ 100 kg, 1 at ≥ 140 kg. */
function heavy(W) {
  return clamp((W - 100) / 40, 0, 1);
}

/**
 * Rating that drives a shot's rating zone (§5.3): close → closeShot, mid → midRange, three → three,
 * layup → layup, dunk → dunk.
 */
export function zoneRating(ratings, zone) {
  switch (zone) {
    case 'three': return ratings.three;
    case 'mid': return ratings.midRange;
    case 'layup': return ratings.layup;
    case 'dunk': return ratings.dunk;
    default: return ratings.closeShot;
  }
}

/**
 * Physical attributes of a legend (§5.1 table; binding values in `test/unit-ratings.mjs`).
 * Besides the table attributes the result carries the listed body numbers (`H`, `W`, `ws`, `reachM`) and two
 * convenience speeds: `sprintSpeed = run × sprintMul` and `handlerSpeed = run × handlerMul` (the "sprint" and
 * "handler" columns of the binding table).
 * @param {object} legend a `LEGENDS[id]` record (or any object with `stats`, `ratings`, `shoulderJoints`)
 * @returns {Readonly<object>} frozen attributes
 */
export function derive(legend) {
  const r = legend.ratings;
  const H = legend.stats.heightM, W = legend.stats.weightKg, ws = legend.stats.wingspanM, reachM = legend.stats.reachM;
  const wt = clamp((W - 88) / 53, 0, 1);
  const run = 4.40 + 1.10 * n(r.speed);
  const sprintMul = 1.22 + 0.16 * n(r.speed);
  const handlerMul = 0.88 + 0.08 * n(r.ballHandle);
  // Heavier and taller bodies accelerate slower: −6 m/s² over 88 → 141 kg and −8 m/s² per metre above 1.98 m.
  const accel = 18 + 10 * n(r.speed) - 6 * wt - 8 * Math.max(0, H - 1.98);
  const hJump = 0.45 + 0.40 * n(r.vertical) - 0.10 * heavy(W);
  const catchR = 0.50 + 0.45 * (ws - 1.90);
  return Object.freeze({
    id: legend.id,
    H, W, ws, reachM,
    run,
    sprintMul,
    handlerMul,
    sprintSpeed: run * sprintMul,
    handlerSpeed: run * handlerMul,
    accel,
    decel: 0.70 * accel + 2,
    turn: 9 + 5 * n(r.speed),
    slideMul: 0.80 + 0.20 * n(r.perimeterD),
    hJump,
    // Ballistic airtime of a jump to apex h: t_up = sqrt(2h/g), total = 2·t_up.
    airtime: 2 * Math.sqrt(2 * hJump / G),
    catchR,
    catchTopY: reachM - 0.15,
    passReceiveR: catchR + 0.25,
    stealRange: 0.90 + 0.75 * (ws - 1.93),
    bodyR: 0.18 + 0.5 * legend.shoulderJoints,
    passSpeed: 9.5 + 4.5 * n(r.passing),
    passRelease: clamp(0.25 - 0.12 * n(r.passing), 0.10, 0.27),
    passSigma: 0.04 + 0.22 * (1 - n(r.passing)),
    staminaDrain: 0.25 * (1 + 0.25 * heavy(W)),
    rebReact: 0.30 - 0.20 * n(r.rebound),
  });
}

/**
 * Airtime of a jump of apex `h` under gravity scaled by `gScale` (Jordan `air` 0.80 on generic layups/dunks,
 * FT-line dunk 0.70): `2·sqrt(2h / (g·gScale))`.
 */
export function airtimeFor(h, gScale = 1) {
  return 2 * Math.sqrt(2 * h / (G * gScale));
}
