// Unit checks for src/shot.js (spec §5.3): Pg binding table, green half-widths, timing factor, CPU / human timing
// expectations, open-shot make expectations, contest maths and the [M] contest examples, points at release (C1),
// make-probability clamps, ability hooks on real shots, miss / air-ball targets.
// Run: node test/unit-shot.mjs
import assert from 'node:assert/strict';
import {
  pg, typeMul, contestA, greenHalfWidth, timingFactor, isAirball, resolveShotZone, shotPoints, shotDistance,
  makeProbability, contestFactor, evaluateShot, makeShotInput, chooseTarget, airBallTarget, meterBand,
  movementFactor, fatigueFactor, diffMul, cpuReleaseError, findContactDefender, releaseHeight, eFromET, eTFromE,
} from '../src/shot.js';
import { LEGENDS, LEGEND_IDS } from '../src/legends.js';
import { derive } from '../src/ratings.js';
import { AbilityLog } from '../src/abilities.js';
import { RIM, BALL, SHOT_V2, LINES, isThree } from '../src/constants.js';
import { Rng } from '../src/math.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (±${tol})`);

// Player fixture (the gameplay Player shape shot.js reads). `plain` strips the abilities (tables "before abilities").
function mk(id, team, x, z, o = {}) {
  return { id, team, pos: { x, z }, vel: { x: 0, z: 0 }, jumpY: 0, isJumping: false, state: 'idle', stamina: 1, defAssign: null, ...o };
}
function plain(id, team, x, z, o = {}) {
  return mk(id, team, x, z, { legend: { ...LEGENDS[id], abilities: [] }, ...o });
}
const at = (d) => RIM.z + d;   // a point straight in front of the rim at distance d

// Expected make probability over a Gaussian release error (dense grid integration of the real evaluateShot).
function expected(shooter, world, input, sigma, clampCpu) {
  let s = 0, w = 0;
  for (let i = -600; i <= 600; i++) {
    const u = i / 100;
    const pdf = Math.exp(-0.5 * u * u);
    let e = u * sigma;
    if (clampCpu) e = Math.max(SHOT_V2.CPU_ET_MIN, Math.min(SHOT_V2.CPU_ET_MAX, e));
    input.eT = e;
    s += evaluateShot(shooter, world, input).p * pdf;
    w += pdf;
  }
  return s / w;
}

check('Pg binding table (§5.3.3, ±0.005)', () => {
  const T = {
    kobe: [0.981, 0.950, 0.886, 0.842, 0.735], jordan: [0.988, 0.958, 0.897, 0.847, 0.689],
    lebron: [0.988, 0.953, 0.890, 0.767, 0.695], giannis: [0.990, 0.950, 0.890, 0.692, 0.587],
    yao: [0.968, 0.899, 0.897, 0.758, 0.428], kyrie: [0.954, 0.960, 0.879, 0.819, 0.769],
  };
  for (const id of LEGEND_IDS) {
    const r = LEGENDS[id].ratings;
    const got = [pg('dunk', 1.0, r), pg('layup', 1.5, r), pg('close', 2.5, r), pg('mid', 5.0, r), pg('three', 7.3, r)];
    for (let i = 0; i < 5; i++) near(got[i], T[id][i], 0.005, id + '[' + i + ']');
  }
});

check('Pg distance terms: close decays 3 %/m beyond 1.5 m, mid 2.5 %/m, deep threes 12 %/m beyond 7.8 m (floor 20 %)', () => {
  const r = LEGENDS.kobe.ratings;
  near(pg('close', 1.0, r), pg('close', 1.5, r), 1e-12);
  near(pg('close', 3.5, r) / pg('close', 1.5, r), 0.94, 1e-12);
  near(pg('mid', 6.5, r) / pg('mid', 3.5, r), 1 - 0.075, 1e-12);
  near(pg('three', 7.8, r), pg('three', 7.3, r), 1e-12);
  near(pg('three', 8.8, r) / pg('three', 7.3, r), 0.88, 1e-12);
  near(pg('three', 30, r) / pg('three', 7.3, r), 0.20, 1e-12);
});

check('generic type multipliers and contest multipliers (§5.3.3, §5.3.6)', () => {
  assert.equal(typeMul('fade'), 0.94); assert.equal(typeMul('stepback'), 0.95); assert.equal(typeMul('turnFade'), 0.95);
  assert.equal(typeMul('floater'), 0.92); assert.equal(typeMul('hook'), 0.90); assert.equal(typeMul('tip'), 0.85);
  assert.equal(typeMul('layup', 'reverse'), 0.97); assert.equal(typeMul('layup', 'euro'), 0.98);
  assert.equal(typeMul('layup', 'power'), 1.00); assert.equal(typeMul('layup', 'fingerRoll'), 1.00);
  assert.equal(typeMul('layup', 'upUnder'), 0.95); assert.equal(typeMul('layup', 'std'), 1);
  assert.equal(typeMul('jumper', 'set'), 1); assert.equal(typeMul('dunk', 'power2'), 1);
  assert.equal(contestA('fade'), 0.85); assert.equal(contestA('stepback'), 0.80); assert.equal(contestA('turnFade'), 0.80);
  assert.equal(contestA('hook'), 0.85); assert.equal(contestA('floater'), 0.75); assert.equal(contestA('layup', 'reverse'), 0.80);
  assert.equal(contestA('layup', 'euro'), 1); assert.equal(contestA('jumper'), 1);
});

check('green half-widths (§5.3.2): Kobe mid 39.4, Kyrie three 38.0, Giannis three 32.3, Yao three 27.3, Jordan layup 61.4 ms', () => {
  const g = SHOT_V2.G_DIFF.normal;
  near(greenHalfWidth(LEGENDS.kobe.ratings.midRange, g, 'jumper') * 1000, 39.4, 0.05);
  near(greenHalfWidth(LEGENDS.kyrie.ratings.three, g, 'jumper') * 1000, 38.0, 0.05);
  near(greenHalfWidth(LEGENDS.giannis.ratings.three, g, 'jumper') * 1000, 32.3, 0.05);
  near(greenHalfWidth(LEGENDS.yao.ratings.three, g, 'jumper') * 1000, 27.3, 0.05);
  near(greenHalfWidth(LEGENDS.jordan.ratings.layup, g, 'layup') * 1000, 61.4, 0.05);
  assert.equal(greenHalfWidth(99, g, 'dunk'), 0);
  assert.equal(greenHalfWidth(99, g, 'tip'), 0);
  assert.deepEqual(SHOT_V2.G_DIFF, { easy: 0.040, normal: 0.033, hard: 0.027 });
});

check('timing factor T(eT) and air ball (§5.3.2)', () => {
  const gS = 0.04;
  assert.equal(timingFactor(0, gS), 1);
  assert.equal(timingFactor(0.04, gS), 1);
  assert.equal(timingFactor(-0.04, gS), 1);
  near(timingFactor(0.0400001, gS), 0.80, 1e-4);
  near(timingFactor(0.165, gS), 0.22, 1e-12);
  near(timingFactor(-(0.04 + 0.125 / 2), gS), 0.51, 1e-12);
  assert.equal(timingFactor(0.1651, gS), 0.12);
  assert.equal(timingFactor(-0.5, gS), 0.12);
  assert.equal(isAirball(-0.175), true);
  assert.equal(isAirball(-0.1749), false);
  near(eFromET(0.11, 0.55), 0.2, 1e-12);
  near(eTFromE(0.2, 0.55), 0.11, 1e-12);
  const band = meterBand(0.0394, 0.536);
  near(band.lo, 0.80 - 0.0394 / 0.536, 1e-12);
  near(band.hi, 0.80 + 0.0394 / 0.536, 1e-12);
});

check('expected timing: CPU T̄ 0.73/0.81/0.89 at gS 33 ms; average human green 62/53/45 %, T̄ 0.87/0.85/0.82', () => {
  const tbar = (sigma, gS, clampCpu) => {
    let s = 0, w = 0, g = 0;
    for (let i = -600; i <= 600; i++) {
      const u = i / 100, pdf = Math.exp(-0.5 * u * u);
      let e = u * sigma;
      if (clampCpu) e = Math.max(-0.25, Math.min(0.22, e));
      s += timingFactor(e, gS) * pdf; g += (Math.abs(e) <= gS ? 1 : 0) * pdf; w += pdf;
    }
    return [s / w, g / w];
  };
  const cpu = [0.075, 0.055, 0.038].map((sg) => tbar(sg, 0.033, true)[0]);
  near(cpu[0], 0.73, 0.006); near(cpu[1], 0.81, 0.006); near(cpu[2], 0.89, 0.006);
  assert.deepEqual([0.73, 0.81, 0.89], [SHOT_V2.CPU_TBAR.easy, SHOT_V2.CPU_TBAR.normal, SHOT_V2.CPU_TBAR.hard]);
  // The human figures use the mean rating factor 1.10 (gS = G_DIFF × 1.10).
  const hum = [0.040, 0.033, 0.027].map((g) => tbar(0.050, g * 1.10, false));
  near(hum[0][1], 0.62, 0.006); near(hum[1][1], 0.53, 0.006); near(hum[2][1], 0.45, 0.006);
  near(hum[0][0], 0.87, 0.008); near(hum[1][0], 0.85, 0.008); near(hum[2][0], 0.82, 0.008);
});

check('CPU release error is N(0, σ) clamped to [−0.25, +0.22] s', () => {
  const rng = new Rng(11);
  let lo = 0, hi = 0, sum = 0;
  for (let i = 0; i < 20000; i++) {
    const e = cpuReleaseError(rng, 0.2);
    assert.ok(e >= -0.25 && e <= 0.22);
    if (e === -0.25) lo++; if (e === 0.22) hi++; sum += e;
  }
  assert.ok(lo > 0 && hi > 0);
  const r2 = new Rng(5);
  let s2 = 0, q2 = 0;
  for (let i = 0; i < 20000; i++) { const e = cpuReleaseError(r2, 0.055); s2 += e; q2 += e * e; }
  near(Math.sqrt(q2 / 20000), 0.055, 0.002);
});

check('rating zone at release and points by the feet at the release step (C1, S8 geometry)', () => {
  assert.equal(resolveShotZone('layup', 1.2, 0, at(1.2)), 'layup');
  assert.equal(resolveShotZone('dunk', 1.0, 0, at(1.0)), 'dunk');
  assert.equal(resolveShotZone('hook', 4.0, 0, at(4.0)), 'close');
  assert.equal(resolveShotZone('floater', 4.4, 0, at(4.4)), 'close');
  assert.equal(resolveShotZone('tip', 0.5, 0, at(0.5)), 'close');
  assert.equal(resolveShotZone('jumper', 3.5, 0, at(3.5)), 'close');
  assert.equal(resolveShotZone('jumper', 3.51, 0, at(3.51)), 'mid');
  assert.equal(resolveShotZone('fade', 7.3, 0, at(7.3)), 'three');
  assert.equal(resolveShotZone('jumper', 6.8, 6.8, -13.0), 'three');     // corner
  // S8: a sprinter pressing 0.1 m outside the arc and releasing 0.4 m inside scores 2; stationary outside 3.
  const R = LINES.THREE_R;
  assert.equal(shotPoints('jumper', 0, at(R + 0.1)), 3);
  assert.equal(shotPoints('jumper', 0, at(R - 0.3)), 2);
  assert.equal(shotPoints('stepback', 0, at(R + 0.2)), 3);
  assert.equal(shotPoints('fade', 6.8, -13), 3);
  assert.equal(shotPoints('layup', 0, at(R + 1)), 2);
  assert.equal(shotPoints('dunk', 0, at(R + 1)), 2);
  assert.equal(shotPoints('tip', 0, at(R + 1)), 2);
  near(shotDistance(3, RIM.z + 4), 5, 1e-12);
});

check('make probability clamps: [0.02, 0.97], dunks to 0.995', () => {
  assert.equal(makeProbability('jumper', 1.2, 1, 1, 1, 1, 1.05, 1.06), 0.97);
  assert.equal(makeProbability('dunk', 1.2, 1, 1, 1, 1, 1, 1), 0.995);
  assert.equal(makeProbability('three', 0.4, 0.12, 0.2, 0.92, 0.8, 1, 0.88), 0.02);
  near(makeProbability('jumper', 0.8, 0.9, 0.7, 0.92, 0.95, 1.05, 0.96), 0.8 * 0.9 * 0.7 * 0.92 * 0.95 * 1.05 * 0.96, 1e-12);
});

check('factors F, M, diffMul (§5.3.4)', () => {
  assert.equal(fatigueFactor(0.29), 0.92); assert.equal(fatigueFactor(0.30), 1);
  assert.equal(movementFactor('jumper', 2.5, 0, 0, at(5)), 1);
  near(movementFactor('jumper', 0, 4.5, 0, at(5)), 1 - 0.07 * 2, 1e-12);
  assert.equal(movementFactor('jumper', 0, 9, 0, at(5)), 0.80);
  // Fade: only the component toward the rim counts (drifting away = no penalty).
  assert.equal(movementFactor('fade', 0, 4.0, 0, at(5)), 1);       // moving +z = away from the rim
  near(movementFactor('fade', 0, -4.0, 0, at(5)), 1 - 0.07 * 1.5, 1e-12);
  assert.equal(movementFactor('layup', 0, -8, 0, at(2)), 1);
  assert.equal(movementFactor('hook', 0, -8, 0, at(2)), 1);
  assert.equal(diffMul('cpu', 'easy'), 0.88); assert.equal(diffMul('cpu', 'normal'), 0.96); assert.equal(diffMul('cpu', 'hard'), 1.00);
  assert.equal(diffMul('human', 'easy'), 1.06); assert.equal(diffMul('human', 'normal'), 1.00); assert.equal(diffMul('human', 'hard'), 0.97);
  assert.equal(diffMul('auto', 'hard'), 1); assert.equal(diffMul('mate', 'easy'), 1);
});

check('open-shot expectations, average human normal (GP §3.4 table, ±0.01)', () => {
  const H = {
    kobe: [0.88, 0.76, 0.72, 0.62], jordan: [0.89, 0.77, 0.73, 0.58], lebron: [0.88, 0.76, 0.65, 0.59],
    giannis: [0.88, 0.76, 0.58, 0.49], yao: [0.82, 0.77, 0.64, 0.35], kyrie: [0.89, 0.75, 0.70, 0.65],
  };
  const inp = makeShotInput();
  inp.side = 'human'; inp.difficulty = 'normal';
  for (const id of LEGEND_IDS) {
    const cases = [['layup', 1.5], ['jumper', 2.5], ['jumper', 5], ['jumper', 7.3]];
    cases.forEach(([kind, d], i) => {
      const sh = plain(id, 0, 0, at(d));
      inp.kind = kind;
      near(expected(sh, { players: [sh] }, inp, 0.050, false), H[id][i], 0.0101, `${id} ${kind} ${d}`);
    });
  }
});

check('open-shot expectations, CPU normal incl. cpuMakeMul (GP §3.4 table, ±0.015)', () => {
  const C = {
    kobe: [0.83, 0.71, 0.68, 0.58], jordan: [0.83, 0.72, 0.68, 0.54], lebron: [0.83, 0.71, 0.61, 0.55],
    giannis: [0.83, 0.71, 0.54, 0.45], yao: [0.77, 0.72, 0.60, 0.32], kyrie: [0.84, 0.70, 0.65, 0.61],
  };
  const inp = makeShotInput();
  inp.side = 'cpu'; inp.difficulty = 'normal';
  for (const id of LEGEND_IDS) {
    [['layup', 1.5], ['jumper', 2.5], ['jumper', 5], ['jumper', 7.3]].forEach(([kind, d], i) => {
      const sh = plain(id, 0, 0, at(d));
      inp.kind = kind;
      near(expected(sh, { players: [sh] }, inp, 0.055, true), C[id][i], 0.015, `${id} ${kind} ${d}`);
    });
  }
});

check('contest parts: LeBron 1.2 m hands-up vs Kobe mid (Kd 0.625, Kh 0.40, Ks 1.04), second contester 0.35', () => {
  const sh = plain('kobe', 0, 0, at(5));
  const lb = plain('lebron', 1, 0, at(5 - 1.2));
  const inp = makeShotInput();
  inp.kind = 'jumper';
  const c = contestFactor(sh, { players: [sh, lb] }, 'jumper', inp);
  near(c.parts.Kd, 0.625, 1e-9);
  near(c.parts.Kh, 0.40, 1e-9);           // 0.65 + (2.64 − 0.05 … 2.69 − 0.05 − 3.00)/1.2 → floor 0.40
  near(c.parts.Ks, 0.70 + 0.40 * (63 / 74), 1e-9);
  near(c.X, c.parts.Kd * c.parts.Kh * c.parts.Ks, 1e-12);
  near(c.C, 1 - 0.55 * c.X, 1e-12);
  assert.equal(c.defender, lb);
  assert.equal(c.zone, 'mid');
  // green release: X × 0.65
  // (contestFactor returns a module scratch object: copy numbers before the next call)
  const openX = c.X;
  inp.green = true;
  const gX = contestFactor(sh, { players: [sh, lb] }, 'jumper', inp).X;
  near(gX, openX * 0.65, 1e-12);
  inp.green = false;
  // a second contester adds 0.35 × his X_i
  const ky = plain('kyrie', 1, 0.6, at(5 - 0.9));
  const two = contestFactor(sh, { players: [sh, lb, ky] }, 'jumper', inp).Xraw;
  const solo = contestFactor(sh, { players: [sh, ky] }, 'jumper', inp).Xraw;
  const solo2 = contestFactor(sh, { players: [sh, lb] }, 'jumper', inp).Xraw;
  near(two, Math.max(solo, solo2) + 0.35 * Math.min(solo, solo2), 1e-12);
});

check('contest eligibility: behind (unless ≤ 0.90 m), stunned / fallen, euro-dodged and out-of-range defenders do not count', () => {
  const sh = plain('jordan', 0, 0, at(5));
  const inp = makeShotInput();
  const behind = plain('lebron', 1, 0, at(5 + 1.0));
  assert.equal(contestFactor(sh, { players: [sh, behind] }, 'jumper', inp).X, 0);
  const sideClose = plain('lebron', 1, 0.85, at(5) + 0.2);   // dot < 0.20 but within 0.90 m
  assert.ok(contestFactor(sh, { players: [sh, sideClose] }, 'jumper', inp).X > 0);
  const front = plain('lebron', 1, 0, at(5 - 1.0));
  assert.ok(contestFactor(sh, { players: [sh, front] }, 'jumper', inp).X > 0);
  front.state = 'stunned';
  assert.equal(contestFactor(sh, { players: [sh, front] }, 'jumper', inp).X, 0);
  front.state = 'fallen';
  assert.equal(contestFactor(sh, { players: [sh, front] }, 'jumper', inp).X, 0);
  front.state = 'idle';
  inp.excluded = front;
  assert.equal(contestFactor(sh, { players: [sh, front] }, 'jumper', inp).X, 0);
  inp.excluded = null;
  const far = plain('lebron', 1, 0, at(5 - 2.25));
  assert.equal(contestFactor(sh, { players: [sh, far] }, 'jumper', inp).X, 0);
  const mate = plain('lebron', 0, 0, at(5 - 0.8));
  assert.equal(contestFactor(sh, { players: [sh, mate] }, 'jumper', inp).X, 0);
});

check('contest examples (GP §3.7, abilities off, average human normal, ±0.025)', () => {
  const T = {
    kobe: [0.65, 0.56, 0.49, 0.42, 0.53], jordan: [0.66, 0.52, 0.50, 0.39, 0.54], lebron: [0.56, 0.51, 0.41, 0.37, 0.45],
    giannis: [0.51, 0.43, 0.37, 0.31, 0.41], yao: [0.59, 0.32, 0.52, 0.28, 0.55], kyrie: [0.60, 0.56, 0.45, 0.42, 0.48],
  };
  const inp = makeShotInput();
  inp.side = 'human'; inp.difficulty = 'normal'; inp.kind = 'jumper';
  const kyrieJump = derive(LEGENDS.kyrie).hJump;
  let worst = 0;
  for (const id of LEGEND_IDS) {
    const cases = [[5, 'lebron', 1.2, 0], [7.3, 'lebron', 1.2, 0], [5, 'lebron', 0.9, 0.6], [7.3, 'lebron', 0.9, 0.6], [5, 'kyrie', 0.9, kyrieJump]];
    cases.forEach(([d, def, dd, jy], i) => {
      const sh = plain(id, 0, 0, at(d));
      const q = plain(def, 1, 0, at(d - dd), { isJumping: jy > 0, jumpY: jy });
      const v = expected(sh, { players: [sh, q] }, inp, 0.050, false);
      worst = Math.max(worst, Math.abs(v - T[id][i]));
      near(v, T[id][i], 0.025, `${id} vs ${def} ${dd} m, d ${d}`);
    });
  }
  console.log('   (max deviation from the [M] table ' + worst.toFixed(3) + ')');
});

check('release heights for Kh (§5.3.6) and the A floor 0.35', () => {
  const y = plain('yao', 0, 0, at(4));
  assert.equal(releaseHeight(y, 'jumper'), 3.45); assert.equal(releaseHeight(y, 'fade'), 3.40);
  assert.equal(releaseHeight(y, 'turnFade'), 3.40); assert.equal(releaseHeight(y, 'hook'), 3.55);
  const k = plain('kobe', 0, 0, at(4), { jumpY: 0.5 });
  assert.equal(releaseHeight(k, 'hook'), 3.00);          // no hook entry → jumper height
  near(releaseHeight(k, 'layup'), 2.64 + 0.15 + 0.5, 1e-12);
  near(releaseHeight(k, 'floater'), 2.64 + 0.10 + 0.5, 1e-12);
  near(releaseHeight(k, 'tip'), 2.64 + 0.5, 1e-12);
  assert.equal(releaseHeight(k, 'dunk'), 3.23);
  // Kobe post fade: A = 0.55 (postFade) × 0.70 (tough) = 0.385 ≥ floor; X uses max(0.35, A).
  const sh = mk('kobe', 0, 0, at(4));
  const q = plain('lebron', 1, 0, at(4 - 1.0));
  const inp = makeShotInput();
  inp.kind = 'turnFade'; inp.variant = 'postFade';
  const c = contestFactor(sh, { players: [sh, q] }, 'turnFade', inp);
  near(c.A, 0.385, 1e-9);
  near(c.X, c.Xraw * 0.385, 1e-9);
  // Yao hook: 0.45, a jab sag halves it again → 0.225, X floors at 0.35.
  const ys = mk('yao', 0, 0, at(3));
  inp.kind = 'hook'; inp.variant = null; inp.sagA = 0.5;
  const h = contestFactor(ys, { players: [ys, plain('giannis', 1, 0, at(3 - 1.0))] }, 'hook', inp);
  near(h.A, 0.225, 1e-9);
  near(h.X, Math.min(1, h.Xraw * 0.35), 1e-9);
});

check('ability ranges in the contest: Yao anchor Rc 3.0 + deter 0.15, Giannis help Rc 2.6', () => {
  const inp = makeShotInput();
  inp.kind = 'layup';
  const sh = plain('kobe', 0, 0, at(2.5));
  const yao = mk('yao', 1, 0, at(2.5 - 2.4));               // Yao 0.1 m from the rim, 2.4 m from the shooter
  const c = contestFactor(sh, { players: [sh, yao] }, 'layup', inp);
  near(c.parts.Kd, (3.0 - 2.4) / (3.0 - 0.6), 1e-9);
  near(c.Xraw, c.parts.Kd * c.parts.Kh * c.parts.Ks + 0.15, 1e-9);
  // the anchor does not cover mid-range jumpers
  inp.kind = 'jumper';
  const sh2 = plain('kobe', 0, 0, at(4.6));
  const yao2 = mk('yao', 1, 0, at(4.6 - 2.4));
  assert.equal(contestFactor(sh2, { players: [sh2, yao2] }, 'jumper', inp).X, 0);
  // Giannis as help defender (assigned to someone else) reaches 2.6 m; as the shooter's man he does not.
  const other = plain('jordan', 0, 3, at(6));
  const g = mk('giannis', 1, 0, at(5 - 2.4), { defAssign: other });
  const sh3 = plain('kobe', 0, 0, at(5));
  near(contestFactor(sh3, { players: [sh3, g, other] }, 'jumper', inp).parts.Kd, (2.6 - 2.4) / 2.0, 1e-9);
  g.defAssign = sh3;
  assert.equal(contestFactor(sh3, { players: [sh3, g, other] }, 'jumper', inp).X, 0);
});

check('strength contact at takeoff (layup/close/dunk) and LeBron power-drive exemption', () => {
  const inp = makeShotInput();
  inp.kind = 'layup';
  const sh = plain('kyrie', 0, 0, at(1.5));
  const big = plain('yao', 1, 0, at(1.5 - 0.6));
  assert.equal(findContactDefender(sh, { players: [sh, big] }), big);
  const c = contestFactor(sh, { players: [sh, big] }, 'layup', inp);
  near(c.contact, Math.max(0.75, 0.88 + 0.004 * (55 - 86)), 1e-12);
  near(c.C, (1 - 0.50 * c.X) * c.contact, 1e-12);
  inp.contactDef = null;   // nobody in contact at takeoff
  assert.equal(contestFactor(sh, { players: [sh, big] }, 'layup', inp).contact, 1);
  inp.contactDef = undefined;
  // jumpers have no contact factor
  inp.kind = 'jumper';
  const sh2 = plain('kyrie', 0, 0, at(5));
  assert.equal(contestFactor(sh2, { players: [sh2, plain('yao', 1, 0, at(5 - 0.6))] }, 'jumper', inp).contact, 1);
  // LeBron within 0.8 s after a won bump: no contact factor
  inp.kind = 'layup';
  const lb = mk('lebron', 0, 0, at(1.5));
  const d = plain('kobe', 1, 0, at(1.5 - 0.6));
  inp.sinceBumpWon = 0.5;
  assert.equal(contestFactor(lb, { players: [lb, d] }, 'layup', inp).contact, 1);
  inp.sinceBumpWon = Infinity;
  near(contestFactor(lb, { players: [lb, d] }, 'layup', inp).contact, Math.min(1, 0.88 + 0.004 * 26), 1e-12);
});

check('evaluateShot: abilities at their hooks, clutch K, FT-line dunk 0.97, forced p, air ball, logging', () => {
  const log = new AbilityLog(256);
  const inp = makeShotInput();
  inp.side = 'human'; inp.difficulty = 'normal'; inp.log = log; inp.t = 1;
  // Kobe post fade: typeMul 1.00 (generic 0.95), A 0.385.
  const kobe = mk('kobe', 0, 0, at(4));
  inp.kind = 'turnFade'; inp.variant = 'postFade'; inp.eT = 0;
  const r = evaluateShot(kobe, { players: [kobe] }, inp);
  near(r.typeMul, 1.0, 1e-12);
  near(r.A, 0.385, 1e-12);
  assert.equal(r.T, 1); assert.equal(r.green, true);
  assert.ok(log.count('kobe.postFade') === 1 && log.count('kobe.tough') === 1);
  // generic turnFade for LeBron keeps 0.95 / 0.80
  const lb = mk('lebron', 0, 0, at(4));
  const r2 = evaluateShot(lb, { players: [lb] }, inp);
  near(r2.typeMul, 0.95, 1e-12); near(r2.A, 0.80, 1e-12);
  // clutch: K 1.05 for Kyrie in the window, 1 for Giannis
  inp.kind = 'jumper'; inp.variant = 'set'; inp.quarter = 4; inp.gameClock = 20; inp.scoreDiff = -2;
  const ky = mk('kyrie', 0, 0, at(5));
  assert.equal(evaluateShot(ky, { players: [ky] }, inp).K, 1.05);
  const gi = mk('giannis', 0, 0, at(5));
  assert.equal(evaluateShot(gi, { players: [gi] }, inp).K, 1);
  inp.scoreDiff = 4;
  assert.equal(evaluateShot(ky, { players: [ky] }, inp).K, 1);
  inp.quarter = 1; inp.gameClock = Infinity; inp.scoreDiff = 0;
  // Jordan FT-line dunk: fixed 0.97, no timing
  const mj = mk('jordan', 0, 0, at(4.4));
  inp.kind = 'dunk'; inp.variant = 'ftDunk'; inp.eT = NaN;
  const fd = evaluateShot(mj, { players: [mj] }, inp);
  assert.equal(fd.p, 0.97); assert.equal(fd.fixed, true); assert.equal(fd.points, 2);
  // Giannis long gather: Pg 0.99 (his n(dunk) = 1 → already 0.99)
  inp.variant = 'longGather';
  near(evaluateShot(gi, { players: [gi] }, inp).pgTyped, 0.99, 1e-12);
  // forced p (debugShoot) and air ball
  inp.kind = 'jumper'; inp.variant = 'set'; inp.eT = 0; inp.forcedP = 1;
  assert.equal(evaluateShot(ky, { players: [ky] }, inp).p, 1);
  inp.forcedP = NaN; inp.eT = -0.2;
  const ab = evaluateShot(ky, { players: [ky] }, inp);
  assert.equal(ab.airball, true); assert.equal(ab.p, 0);
  // estimates never log
  const before = log.total;
  inp.estimate = true; inp.eT = NaN; inp.side = 'cpu';
  inp.kind = 'turnFade'; inp.variant = 'postFade';
  const est = evaluateShot(kobe, { players: [kobe] }, inp);
  assert.equal(log.total, before);
  assert.equal(est.T, SHOT_V2.CPU_TBAR.normal);
});

check('Yao hook and up-and-under, Kyrie floater and stepback, Jordan fade: type multipliers 1.00', () => {
  const inp = makeShotInput();
  inp.eT = 0;
  const cases = [['yao', 'hook', null, 1.0, 0.45], ['yao', 'layup', 'upUnder', 1.0, 1], ['kyrie', 'floater', null, 1.0, 0.60],
    ['kyrie', 'stepback', null, 1.0, 0.60], ['jordan', 'fade', null, 1.0, 0.65], ['jordan', 'turnFade', null, 1.0, 0.65],
    ['giannis', 'hook', null, 0.90, 0.85], ['lebron', 'layup', 'upUnder', 0.95, 1], ['kobe', 'floater', null, 0.92, 0.75]];
  for (const [id, kind, variant, tm, A] of cases) {
    const p = mk(id, 0, 0, at(3));
    inp.kind = kind; inp.variant = variant;
    const r = evaluateShot(p, { players: [p] }, inp);
    near(r.typeMul, tm, 1e-12, id + ' ' + kind + ' typeMul');
    near(r.A, id === 'kobe' && kind !== 'floater' ? A * 0.7 : A, 1e-12, id + ' ' + kind + ' A');
  }
});

check('targets: dunk rim centre, made disc, early short / late long, green misses both ways, layup short, air ball', () => {
  const rng = new Rng(3);
  const sx = 0, sz = at(6);
  const t = chooseTarget(false, NaN, 0, 'dunk', sx, sz, 1, rng);
  assert.equal(t.x, RIM.x); assert.equal(t.z, RIM.z); assert.equal(t.y, RIM.y);
  for (let i = 0; i < 200; i++) {
    const m = chooseTarget(true, 0, 0.04, 'jumper', sx, sz, 1, rng);
    assert.ok(Math.hypot(m.x - RIM.x, m.z - RIM.z) <= SHOT_V2.MAKE_DISC + 1e-12);
    const early = chooseTarget(false, -0.1, 0.04, 'jumper', sx, sz, 1, rng);
    assert.ok(early.z > RIM.z + RIM.r);           // short = toward the shooter (+z here)
    const late = chooseTarget(false, 0.1, 0.04, 'jumper', sx, sz, 1, rng);
    assert.ok(late.z < RIM.z - RIM.r);
    const lay = chooseTarget(false, 0.0, 0.06, 'layup', sx, sz, 1, rng);
    near(lay.z - RIM.z, RIM.r + BALL.R * 0.6, 0.25 + 1e-9);
    assert.equal(lay.airball, false);
  }
  let shortN = 0, longN = 0;
  for (let i = 0; i < 400; i++) {
    const g = chooseTarget(false, 0.01, 0.04, 'jumper', sx, sz, 1, rng);
    if (g.z > RIM.z) shortN++; else longN++;
  }
  assert.ok(shortN > 150 && longN > 150, `green misses short ${shortN} long ${longN}`);
  for (let i = 0; i < 300; i++) {
    const a = chooseTarget(false, -0.2, 0.04, 'jumper', sx, sz, 0.5, rng);
    assert.equal(a.airball, true);
    near(a.y, RIM.y - 0.55, 1e-12);
    const along = a.z - RIM.z;               // shooter straight in front: along the +z axis
    assert.ok(along >= 0.50 - 1e-9 && along <= 0.80 + 1e-9, 'air ball along ' + along);
    assert.ok(Math.hypot(a.x - RIM.x, a.z - RIM.z) > RIM.r + BALL.R);
  }
  const b = airBallTarget(5, at(5), new Rng(9));
  assert.ok(b.airball && Math.hypot(b.x - RIM.x, b.z - RIM.z) >= 0.5 - 1e-9);
});

check('isThree classifies feet used by the points rule', () => {
  assert.equal(isThree(0, RIM.z + 7.24), true);
  assert.equal(isThree(0, RIM.z + 7.23), false);
});

console.log(passed + ' checks passed');
