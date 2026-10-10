// Unit checks for src/ratings.js (spec §5.1): the normaliser, every derived attribute of the six legends against the
// binding table (tolerance: one unit of the shown precision), formula identities and freezing.
// Run: node test/unit-ratings.mjs
import assert from 'node:assert/strict';
import { n, derive, zoneRating, airtimeFor } from '../src/ratings.js';
import { LEGENDS, LEGEND_IDS } from '../src/legends.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

// §5.1 binding table, values as printed (strings keep the shown precision).
const COLS = ['run', 'sprintSpeed', 'handlerSpeed', 'accel', 'decel', 'turn', 'slideMul', 'hJump', 'airtime', 'catchR',
  'catchTopY', 'stealRange', 'bodyR', 'passSpeed', 'passRelease', 'passSigma'];
const TABLE = {
  kobe: '5.29 7.14 5.03 25.2 19.6 13.1 0.98 0.79 0.80 0.595 2.49 1.03 0.408 13.0 0.158 0.091',
  jordan: '5.38 7.33 5.10 25.8 20.1 13.5 0.99 0.82 0.82 0.595 2.50 1.03 0.410 13.0 0.158 0.091',
  lebron: '5.32 7.21 5.05 22.9 18.0 13.2 0.97 0.76 0.79 0.608 2.54 1.06 0.433 13.9 0.133 0.046',
  giannis: '5.34 7.24 4.99 23.0 18.1 13.3 0.97 0.80 0.81 0.640 2.66 1.11 0.423 12.8 0.162 0.099',
  yao: '4.59 5.73 4.13 11.3 9.9 9.9 0.87 0.44 0.60 0.662 2.80 1.15 0.425 12.0 0.184 0.138',
  kyrie: '5.38 7.33 5.17 26.9 20.8 13.5 0.92 0.75 0.78 0.514 2.37 0.90 0.393 13.1 0.154 0.085',
};

function unitOf(s) {
  const dot = s.indexOf('.');
  return dot < 0 ? 1 : Math.pow(10, -(s.length - dot - 1));
}

check('n(r) = clamp((r − 25)/74, 0, 1)', () => {
  assert.equal(n(25), 0);
  assert.equal(n(99), 1);
  assert.equal(n(10), 0);
  assert.equal(n(120), 1);
  assert.ok(Math.abs(n(62) - 0.5) < 1e-12);
  assert.ok(Math.abs(n(98) - 73 / 74) < 1e-12);
});

check('derived attributes match the §5.1 binding table for all six legends', () => {
  for (const id of LEGEND_IDS) {
    const a = derive(LEGENDS[id]);
    const shown = TABLE[id].split(' ');
    assert.equal(shown.length, COLS.length);
    for (let i = 0; i < COLS.length; i++) {
      const want = Number(shown[i]);
      const tol = unitOf(shown[i]) + 1e-9;
      const got = a[COLS[i]];
      assert.ok(Number.isFinite(got), `${id}.${COLS[i]} finite`);
      assert.ok(Math.abs(got - want) <= tol, `${id}.${COLS[i]}: ${got} vs ${want} (±${tol})`);
    }
  }
});

check('formula identities: sprint/handler speeds, decel, airtime, receive radius', () => {
  for (const id of LEGEND_IDS) {
    const a = derive(LEGENDS[id]);
    const r = LEGENDS[id].ratings;
    assert.ok(Math.abs(a.sprintSpeed - a.run * a.sprintMul) < 1e-12);
    assert.ok(Math.abs(a.handlerSpeed - a.run * a.handlerMul) < 1e-12);
    assert.ok(Math.abs(a.decel - (0.70 * a.accel + 2)) < 1e-12);
    assert.ok(Math.abs(a.airtime - 2 * Math.sqrt(2 * a.hJump / 9.81)) < 1e-12);
    assert.ok(Math.abs(a.passReceiveR - (a.catchR + 0.25)) < 1e-12);
    assert.ok(Math.abs(a.catchTopY - (LEGENDS[id].stats.reachM - 0.15)) < 1e-12);
    assert.ok(Math.abs(a.sprintMul - (1.22 + 0.16 * n(r.speed))) < 1e-12);
    assert.ok(a.passRelease >= 0.10 && a.passRelease <= 0.27);
    assert.ok(Math.abs(a.rebReact - (0.30 - 0.20 * n(r.rebound))) < 1e-12);
    assert.ok(Math.abs(a.bodyR - (0.18 + 0.5 * LEGENDS[id].shoulderJoints)) < 1e-12);
  }
});

check('stamina drain grows with weight above 100 kg (Yao 0.3125, Kyrie 0.25)', () => {
  assert.ok(Math.abs(derive(LEGENDS.yao).staminaDrain - 0.25 * 1.25) < 1e-12);
  assert.ok(Math.abs(derive(LEGENDS.kyrie).staminaDrain - 0.25) < 1e-12);
  const lb = derive(LEGENDS.lebron).staminaDrain;
  assert.ok(Math.abs(lb - 0.25 * (1 + 0.25 * (13.4 / 40))) < 1e-12);
});

check('body radii span 0.393–0.433 m and pair minima 0.79–0.87 m (C3)', () => {
  const rs = LEGEND_IDS.map((id) => derive(LEGENDS[id]).bodyR);
  const lo = Math.min(...rs), hi = Math.max(...rs);
  assert.ok(Math.abs(lo - 0.3925) < 1e-9 && Math.abs(hi - 0.4325) < 1e-9);
  assert.ok(2 * lo >= 0.78 && 2 * hi <= 0.87);
});

check('Yao is the slowest, Kyrie / Jordan the quickest; turn rates Yao 9.9 / Kyrie 13.5 rad/s (C21)', () => {
  const run = (id) => derive(LEGENDS[id]).run;
  for (const id of LEGEND_IDS) if (id !== 'yao') assert.ok(run(id) > run('yao'));
  assert.ok(Math.abs(derive(LEGENDS.yao).turn - 9.88) < 0.01);
  assert.ok(Math.abs(derive(LEGENDS.kyrie).turn - 13.46) < 0.01);
});

check('derive() is pure and frozen; zoneRating and airtimeFor helpers', () => {
  const a = derive(LEGENDS.kobe), b = derive(LEGENDS.kobe);
  assert.deepEqual(a, b);
  assert.ok(Object.isFrozen(a));
  assert.throws(() => { 'use strict'; a.run = 1; });
  const r = LEGENDS.kobe.ratings;
  assert.equal(zoneRating(r, 'three'), 84);
  assert.equal(zoneRating(r, 'mid'), 98);
  assert.equal(zoneRating(r, 'close'), 92);
  assert.equal(zoneRating(r, 'layup'), 95);
  assert.equal(zoneRating(r, 'dunk'), 88);
  // Jordan `air`: gravity × 0.80 → airtime × 1/sqrt(0.8) = × 1.118 (hJump 0.82 → 0.92 s).
  const j = derive(LEGENDS.jordan);
  assert.ok(Math.abs(airtimeFor(j.hJump, 0.80) / j.airtime - 1.118) < 0.001);
  assert.ok(Math.abs(airtimeFor(j.hJump, 0.80) - 0.92) < 0.01);
  // FT-line dunk: h 1.00 at g × 0.70 → 1.08 s (C10).
  assert.ok(Math.abs(airtimeFor(1.0, 0.70) - 1.08) < 0.005);
});

console.log(passed + ' checks passed');
