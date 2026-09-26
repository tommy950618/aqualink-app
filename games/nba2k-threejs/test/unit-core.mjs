// Unit checks for the dependency-free core modules: math.js, constants.js, i18n.js, teams.js.
// Run: node test/unit-core.mjs
import assert from 'node:assert/strict';
import { Rng, clamp, lerp, damp, wrapAngle, lerpAngle, dist2, norm2, smoothstep, SCRATCH } from '../src/math.js';
import { isThree, DIFFICULTY, CLOCK, SLOTS, COLORS, RIM, LINES, FIXED_DT } from '../src/constants.js';
import { STRINGS, t, setLang, getLang, toggleLang, applyDom, onLangChange } from '../src/i18n.js';
import { TEAMS } from '../src/teams.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

check('Rng(7) is deterministic across two instances', () => {
  const a = new Rng(7), b = new Rng(7);
  for (let i = 0; i < 1000; i++) assert.equal(a.next(), b.next());
  for (let i = 0; i < 200; i++) assert.equal(a.gauss(0, 1), b.gauss(0, 1));
  for (let i = 0; i < 200; i++) assert.equal(a.int(10), b.int(10));
  const c = new Rng(8);
  assert.notEqual(new Rng(7).next(), c.next());
});

check('Rng.next stays in [0,1) and range/int/pick respect bounds', () => {
  const r = new Rng(123);
  for (let i = 0; i < 10000; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1);
    const w = r.range(-2, 3);
    assert.ok(w >= -2 && w < 3);
    const n = r.int(5);
    assert.ok(Number.isInteger(n) && n >= 0 && n < 5);
  }
  const arr = ['a', 'b', 'c'];
  for (let i = 0; i < 100; i++) assert.ok(arr.includes(r.pick(arr)));
});

check('gauss mean ~ 0 and sigma ~ 1 over 5000 samples', () => {
  const r = new Rng(42);
  let sum = 0, sumSq = 0;
  const N = 5000;
  for (let i = 0; i < N; i++) { const g = r.gauss(0, 1); sum += g; sumSq += g * g; }
  const mean = sum / N;
  const sd = Math.sqrt(sumSq / N - mean * mean);
  assert.ok(Math.abs(mean) < 0.06, 'mean ' + mean);
  assert.ok(Math.abs(sd - 1) < 0.06, 'sd ' + sd);
});

check('isThree classifies the spec sample points', () => {
  assert.equal(isThree(0, -4.8), true);
  assert.equal(isThree(0, -8.3), false);
  assert.equal(isThree(6.71, -13), true);
  assert.equal(isThree(6.5, -13), false);
  assert.equal(isThree(0, -5.51), true);   // arc top
  assert.equal(isThree(0, -5.6), false);   // just inside the arc
  for (const s of SLOTS) assert.equal(isThree(s.x, s.z), true, s.id);
});

check('court constants are internally consistent', () => {
  assert.equal(LINES.ARC_TOP_Z, RIM.z + LINES.THREE_R);
  const arcZ = RIM.z + Math.sqrt(LINES.THREE_R ** 2 - LINES.CORNER_X ** 2);
  assert.ok(Math.abs(arcZ - LINES.CORNER_Z_END) < 0.01);
  assert.equal(FIXED_DT, 1 / 60);
  assert.equal(SLOTS.length, 5);
  assert.equal(SLOTS.leftWing.x, -5.4);
  assert.deepEqual(CLOCK.QUARTER_OPTIONS, [60, 120, 180, 300]);
  assert.equal(COLORS.skin.length, 3);
});

check('DIFFICULTY holds the full section 7 table', () => {
  const keys = ['reaction', 'cpuSigma', 'userGreen', 'stealRate', 'defGap', 'help', 'shootOpen', 'sprintProb', 'crossFreeze'];
  for (const lvl of ['easy', 'normal', 'hard']) for (const k of keys) assert.equal(typeof DIFFICULTY[lvl][k], 'number', lvl + '.' + k);
  assert.deepEqual(keys.map((k) => DIFFICULTY.normal[k]), [0.26, 0.10, 0.06, 0.18, 1.3, 0.6, 1.5, 0.6, 0.55]);
  assert.deepEqual(keys.map((k) => DIFFICULTY.easy[k]), [0.40, 0.14, 0.07, 0.10, 1.7, 0.3, 1.9, 0.3, 0.35]);
  assert.deepEqual(keys.map((k) => DIFFICULTY.hard[k]), [0.14, 0.06, 0.05, 0.28, 1.0, 0.9, 1.2, 0.9, 0.70]);
});

check('math helpers', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(lerp(0, 10, 0.25), 2.5);
  assert.ok(Math.abs(damp(0, 10, 5, 0.2) - 10 * (1 - Math.exp(-1))) < 1e-12);
  assert.ok(Math.abs(wrapAngle(Math.PI * 3) - Math.PI) < 1e-12);
  assert.ok(Math.abs(wrapAngle(-Math.PI * 2.5) + Math.PI / 2) < 1e-12);
  assert.ok(Math.abs(lerpAngle(3, -3, 0.5) - Math.PI) < 1e-9);
  assert.equal(dist2(0, 0, 3, 4), 5);
  const o = norm2({ x: 0, z: 0 }, 3, 4);
  assert.ok(Math.abs(o.x - 0.6) < 1e-12 && Math.abs(o.z - 0.8) < 1e-12);
  norm2(o, 0, 0);
  assert.equal(o.x, 0); assert.equal(o.z, 0);
  assert.equal(smoothstep(0.5), 0.5);
  assert.equal(smoothstep(2, 1, 3), 0.5);
  assert.equal(smoothstep(-1), 0);
  assert.ok(SCRATCH.v3a && SCRATCH.v3b && SCRATCH.v3c && typeof SCRATCH.v3a.set === 'function');
});

check('i18n tables share the same key set and interpolate', () => {
  const zh = Object.keys(STRINGS.zh).sort(), en = Object.keys(STRINGS.en).sort();
  assert.deepEqual(zh, en);
  assert.ok(zh.length >= 70, 'key count ' + zh.length);
  assert.equal(getLang(), 'zh');
  assert.equal(t('menu.start'), '开始比赛');
  assert.equal(t('cap.make3', { name: 'Lin Hai' }), 'Lin Hai 三分命中！');
  assert.equal(t('hud.q', { n: 2 }), '第2节');
  assert.equal(t('nope.missing'), 'nope.missing');
  let seen = null;
  const off = onLangChange((l) => { seen = l; });
  assert.equal(toggleLang(), 'en');
  assert.equal(seen, 'en');
  assert.equal(t('menu.start'), 'Start Game');
  assert.equal(t('banner.quarterEnd', { n: 4 }), 'END OF Q4');
  off();
  assert.equal(setLang('xx'), 'en');
  setLang('zh');
  assert.equal(seen, 'en');
  applyDom();   // no DOM in Node: must be a no-op
});

check('teams data', () => {
  assert.equal(TEAMS.length, 2);
  assert.deepEqual(TEAMS.map((x) => x.id), ['HBT', 'RRF']);
  for (const team of TEAMS) {
    assert.equal(team.players.length, 3);
    for (const p of team.players) for (const k of ['speed', 'shooting', 'defense', 'dunk', 'height']) assert.equal(typeof p[k], 'number');
  }
});

console.log(passed + ' checks passed');
