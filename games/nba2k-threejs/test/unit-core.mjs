// Unit checks for the dependency-free core: math.js, constants.js (v1 court constants + every v2 table of §5),
// metrics.js (possessions, assists C27, catchToPress, schema), the model-level rule fixtures (R1 feet at release,
// R5 blocked three that drops keeps 3, R6 STL at the defensive catch of a floor-bounced pass), i18n API sanity and
// the H6 / H8 source rules for the WP4a files.
// Run: node test/unit-core.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Rng, clamp, lerp, damp, wrapAngle, lerpAngle, dist2, norm2, smoothstep, SCRATCH } from '../src/math.js';
import {
  isThree, DIFFICULTY, CLOCK, RIM, LINES, COURT, BOARD, BALL, FIXED_DT, FORMATION, RIM_PHYS, SEPARATION, SLOTS_V2,
  SHOT_V2, BLOCK, STEAL, PASS, INTERCEPT, STRENGTH, POST, REBOUND, MOVES_V2, SHAKE, JAB, PUMP_FAKE, TRIGGERS, RULES_V2,
  SHOT_KINDS, MOVE, SHOT, JUMP, SLOTS, COLORS, PERF,
} from '../src/constants.js';
import { STRINGS, t, getLang, setLang } from '../src/i18n.js';
import { LEGENDS, LEGEND_IDS } from '../src/legends.js';
import { n } from '../src/ratings.js';
import { shotPoints } from '../src/shot.js';
import { Metrics } from '../src/metrics.js';
import { ABILITY_IDS } from '../src/abilities.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (±${tol})`);

// ------------------------------------------------------------------------------------------------ math.js (v1)

check('Rng(7) is deterministic across two instances', () => {
  const a = new Rng(7), b = new Rng(7);
  for (let i = 0; i < 1000; i++) assert.equal(a.next(), b.next());
  for (let i = 0; i < 200; i++) assert.equal(a.gauss(0, 1), b.gauss(0, 1));
  for (let i = 0; i < 200; i++) assert.equal(a.int(10), b.int(10));
  assert.notEqual(new Rng(7).next(), new Rng(8).next());
});

check('Rng.next stays in [0,1) and range/int/pick respect bounds; gauss moments', () => {
  const r = new Rng(123);
  for (let i = 0; i < 10000; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1);
    const w = r.range(-2, 3);
    assert.ok(w >= -2 && w < 3);
    const k = r.int(5);
    assert.ok(Number.isInteger(k) && k >= 0 && k < 5);
  }
  const g = new Rng(42);
  let sum = 0, sumSq = 0;
  for (let i = 0; i < 5000; i++) { const x = g.gauss(0, 1); sum += x; sumSq += x * x; }
  const mean = sum / 5000;
  assert.ok(Math.abs(mean) < 0.06 && Math.abs(Math.sqrt(sumSq / 5000 - mean * mean) - 1) < 0.06);
});

check('math helpers', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(lerp(0, 10, 0.25), 2.5);
  assert.ok(Math.abs(damp(0, 10, 5, 0.2) - 10 * (1 - Math.exp(-1))) < 1e-12);
  assert.ok(Math.abs(wrapAngle(Math.PI * 3) - Math.PI) < 1e-12);
  assert.ok(Math.abs(lerpAngle(3, -3, 0.5) - Math.PI) < 1e-9);
  assert.equal(dist2(0, 0, 3, 4), 5);
  const o = norm2({ x: 0, z: 0 }, 3, 4);
  assert.ok(Math.abs(o.x - 0.6) < 1e-12 && Math.abs(o.z - 0.8) < 1e-12);
  assert.equal(smoothstep(2, 1, 3), 0.5);
  assert.ok(SCRATCH.v3a && typeof SCRATCH.v3a.set === 'function');
});

// ------------------------------------------------------------------------------------------------ constants (v1 kept)

check('v1 court constants unchanged (COURT, RIM, BOARD, LINES, BALL, FIXED_DT) and isThree samples', () => {
  assert.deepEqual({ ...RIM }, { x: 0, y: 3.048, z: -12.75, r: 0.2286, tube: 0.012, collideTube: 0.02 });
  assert.equal(COURT.HALF_W, 7.62); assert.equal(COURT.BASELINE_Z, -14.325); assert.equal(COURT.MID_Z, 0);
  assert.equal(BOARD.min.x, -0.915); assert.equal(BOARD.max.z, -13.105); assert.equal(BOARD.min.y, 2.90); assert.equal(BOARD.max.y, 3.97);
  assert.equal(LINES.ARC_TOP_Z, RIM.z + LINES.THREE_R);
  const arcZ = RIM.z + Math.sqrt(LINES.THREE_R ** 2 - LINES.CORNER_X ** 2);
  assert.ok(Math.abs(arcZ - LINES.CORNER_Z_END) < 0.01);
  assert.equal(BALL.R, 0.12); assert.equal(BALL.REST_RIM, 0.55); assert.equal(BALL.REST_BOARD, 0.60); assert.equal(BALL.G, 9.81);
  assert.equal(FIXED_DT, 1 / 60);
  assert.equal(isThree(0, -4.8), true); assert.equal(isThree(0, -8.3), false);
  assert.equal(isThree(6.71, -13), true); assert.equal(isThree(6.5, -13), false);
  assert.equal(isThree(0, -5.51), true); assert.equal(isThree(0, -5.6), false);
  for (const s of SLOTS) assert.equal(isThree(s.x, s.z), true, s.id);
  assert.deepEqual(CLOCK.QUARTER_OPTIONS, [60, 120, 180, 300]);
  assert.equal(CLOCK.SHOT, 14); assert.equal(CLOCK.OT, 60); assert.equal(CLOCK.HALFTIME, 3.0); assert.equal(CLOCK.BUZZER_LOOSE, 0.5);
  assert.deepEqual({ ...CLOCK.DEAD }, { MADE: 1.5, OOB: 1.2, SHOT_CLOCK: 1.2, TURNOVER: 1.0 });
  assert.deepEqual({ ...FORMATION.HANDLER }, { x: 0, z: -4.6 }); assert.equal(FORMATION.DEF_LERP, 0.18);
  // deprecated v1 objects stay importable until WP9 removes their last importers
  assert.ok(MOVE && SHOT && JUMP && COLORS && PERF);
  assert.equal(MOVE.AI_CLAMP_X, 7.4); assert.equal(MOVE.STAMINA_REFILL, 1 / 6);
});

// ------------------------------------------------------------------------------------------------ constants (v2)

check('DIFFICULTY v2 holds the full §5.11 table; v1 shootOpen / crossFreeze / stealRate are gone (C30)', () => {
  const keys = ['reaction', 'cpuSigma', 'cpuMakeMul', 'userMakeMul', 'userGreen', 'userBlockMul', 'cpuBlockMul', 'contestJumpP',
    'jumpSigma', 'cpuStealS0', 'cpuStealInterval', 'defGap', 'help', 'sprintProb', 'cpuShakeMul', 'humanShakeMul', 'cpuPassMul',
    'cpuDriveMul', 'biteBase', 'interceptGamble', 'riskTolMul'];
  const want = {
    easy: [0.36, 0.075, 0.88, 1.06, 0.040, 1.15, 0.55, 0.35, 0.12, 0.14, 2.4, 1.60, 0.30, 0.35, 0.60, 1.15, 1.40, 0.70, 0.55, 0.50, 1.60],
    normal: [0.24, 0.055, 0.96, 1.00, 0.033, 1.00, 0.80, 0.55, 0.08, 0.21, 1.6, 1.25, 0.60, 0.60, 0.85, 1.00, 1.00, 1.00, 0.40, 0.80, 1.00],
    hard: [0.15, 0.038, 1.00, 0.97, 0.027, 0.90, 1.00, 0.75, 0.05, 0.28, 1.1, 1.00, 0.90, 0.85, 1.00, 0.85, 0.80, 1.10, 0.25, 1.00, 0.70],
  };
  for (const lvl of ['easy', 'normal', 'hard']) {
    assert.equal(DIFFICULTY[lvl].id, lvl);
    assert.deepEqual(keys.map((k) => DIFFICULTY[lvl][k]), want[lvl], lvl);
    for (const gone of ['shootOpen', 'crossFreeze', 'stealRate']) assert.equal(DIFFICULTY[lvl][gone], undefined);
    assert.equal(DIFFICULTY[lvl].userGreen, SHOT_V2.G_DIFF[lvl]);
  }
  assert.ok(Object.isFrozen(DIFFICULTY.hard));
});

check('rim physics, separation, SLOTS_V2 spots (§2.5, §5.2, §5.3.7)', () => {
  assert.deepEqual({ ...RIM_PHYS }, { REST_RIM: 0.40, TANGENTIAL: 0.80, REST_BOARD: 0.50 });
  assert.deepEqual({ ...SEPARATION }, { AIR_ADD: 0.10, DUNKER_MIN: 0.95 });
  const want = {
    top: [0, -4.9], leftElbow: [-2.44, -8.6], rightElbow: [2.44, -8.6], leftWing: [-5.4, -7.6], rightWing: [5.4, -7.6],
    leftBlock: [-2.0, -11.6], rightBlock: [2.0, -11.6], leftCorner: [-7.0, -13.3], rightCorner: [7.0, -13.3],
    leftDunker: [-3.0, -13.6], rightDunker: [3.0, -13.6], rightBaseline: [5.0, -12.8],
  };
  assert.equal(SLOTS_V2.list.length, 12);
  for (const id of Object.keys(want)) assert.deepEqual([SLOTS_V2[id].x, SLOTS_V2[id].z], want[id], id);
  for (const s of SLOTS_V2.list) assert.equal(SLOTS_V2[s.id], s);
  // every legend spot refers to a slot
  for (const id of LEGEND_IDS) for (const sid of Object.keys(LEGENDS[id].spots)) assert.ok(SLOTS_V2[sid], sid);
  assert.deepEqual([...SHOT_KINDS], ['jumper', 'fade', 'stepback', 'turnFade', 'hook', 'floater', 'layup', 'dunk', 'tip']);
});

check('SHOT_V2 constants (§5.3)', () => {
  assert.equal(SHOT_V2.CLOSE_D, 3.5); assert.equal(SHOT_V2.LAYUP_G_ADD, 0.022); assert.equal(SHOT_V2.AIRBALL_ET, -0.175);
  assert.equal(SHOT_V2.T_EDGE, 0.165); assert.equal(SHOT_V2.T_EDGE_HI, 0.80); assert.equal(SHOT_V2.T_EDGE_LO, 0.22); assert.equal(SHOT_V2.T_BAD, 0.12);
  assert.deepEqual({ ...SHOT_V2.CMAX }, { three: 0.55, mid: 0.55, close: 0.60, layup: 0.50, dunk: 0.12 });
  assert.equal(SHOT_V2.RC, 2.2); assert.equal(SHOT_V2.SECOND_W, 0.35); assert.equal(SHOT_V2.A_FLOOR, 0.35); assert.equal(SHOT_V2.GREEN_X, 0.65);
  assert.equal(SHOT_V2.DUNK_REL_Y, 3.23); assert.equal(SHOT_V2.P_MAX_DUNK, 0.995); assert.equal(SHOT_V2.TIP_T, 0.85);
  assert.equal(SHOT_V2.AIRBALL_DY, -0.55); assert.equal(SHOT_V2.METER_IDEAL, 0.80); assert.equal(SHOT_V2.METER_MAX, 1.25);
  assert.equal(SHOT_V2.CPU_ET_MIN, -0.25); assert.equal(SHOT_V2.CPU_ET_MAX, 0.22);
});

check('BLOCK constants reproduce the §4.3 block probability table (human blocker, normal; ±0.006)', () => {
  // blocker \ shooter: jumper / close / layup / dunk (dunk = dunk stuff B0 0.22, cap 0.30)
  const T = {
    kobe: { jordan: [.19, .22, .25, .14], lebron: [.18, .21, .24, .13], giannis: [.18, .20, .23, .13], yao: [.15, .18, .21, .11], kyrie: [.20, .24, .27, .15] },
    jordan: { kobe: [.24, .28, .31, .17], lebron: [.22, .26, .30, .16], giannis: [.22, .25, .29, .16], yao: [.19, .22, .25, .14], kyrie: [.25, .29, .33, .18] },
    lebron: { kobe: [.29, .34, .38, .21], jordan: [.29, .34, .38, .21], giannis: [.27, .31, .35, .19], yao: [.23, .27, .31, .17], kyrie: [.30, .36, .41, .22] },
    giannis: { kobe: [.30, .40, .45, .26], jordan: [.30, .40, .45, .26], lebron: [.30, .39, .44, .24], yao: [.29, .33, .38, .21], kyrie: [.30, .40, .45, .27] },
    yao: { kobe: [.30, .40, .45, .30], jordan: [.30, .40, .45, .30], lebron: [.30, .40, .45, .29], giannis: [.30, .40, .45, .29], kyrie: [.30, .40, .45, .30] },
    kyrie: { kobe: [.13, .15, .17, .10], jordan: [.13, .15, .17, .10], lebron: [.12, .14, .17, .09], giannis: [.12, .14, .16, .09], yao: [.10, .12, .14, .08] },
  };
  for (const b of Object.keys(T)) {
    for (const s of Object.keys(T[b])) {
      const blkF = BLOCK.BLKF_BASE + BLOCK.BLKF_K * n(LEGENDS[b].ratings.block);
      const hAdv = clamp(1 + BLOCK.HADV_K * (LEGENDS[b].stats.heightM - LEGENDS[s].stats.heightM), BLOCK.HADV_MIN, BLOCK.HADV_MAX);
      const pB = [
        Math.min(BLOCK.CAP.jumper, BLOCK.B0.jumper * blkF * hAdv),
        Math.min(BLOCK.CAP.close, BLOCK.B0.close * blkF * hAdv),
        Math.min(BLOCK.CAP.layup, BLOCK.B0.layup * blkF * hAdv),
        Math.min(BLOCK.DUNK_CAP, BLOCK.DUNK_B0 * blkF * hAdv),
      ];
      for (let i = 0; i < 4; i++) near(pB[i], T[b][s][i], 0.006, `${b} blocks ${s} [${i}]`);
    }
  }
  assert.deepEqual([BLOCK.WINDOW.jumper, BLOCK.WINDOW.hook, BLOCK.WINDOW.floater, BLOCK.WINDOW.layup], [0.22, 0.26, 0.26, 0.30]);
  assert.deepEqual([BLOCK.R_HAND, BLOCK.R_HAND_CHASE, BLOCK.R_HAND_BIG], [0.30, 0.36, 0.34]);
  assert.deepEqual([BLOCK.CHASE_B0, BLOCK.CHASE_CAP, BLOCK.CHASE_WINDOW], [0.50, 0.55, 0.40]);
});

check('STEAL constants reproduce the §5.5 per-attempt poke table (human S0 / CPU-normal S0; ±0.006)', () => {
  const T = {
    kobe: { jordan: [.23, .16], lebron: [.23, .16], giannis: [.27, .19], yao: [.38, .26], kyrie: [.19, .13] },
    jordan: { kobe: [.24, .17], lebron: [.25, .17], giannis: [.29, .20], yao: [.41, .29], kyrie: [.21, .15] },
    lebron: { kobe: [.20, .14], jordan: [.21, .15], giannis: [.25, .17], yao: [.35, .24], kyrie: [.18, .12] },
    giannis: { kobe: [.19, .14], jordan: [.20, .14], lebron: [.20, .14], yao: [.33, .23], kyrie: [.17, .12] },
    yao: { kobe: [.13, .09], jordan: [.13, .09], lebron: [.13, .09], giannis: [.16, .11], kyrie: [.11, .08] },
    kyrie: { kobe: [.19, .13], jordan: [.20, .14], lebron: [.20, .14], giannis: [.23, .16], yao: [.33, .23] },
  };
  for (const d of Object.keys(T)) {
    for (const h of Object.keys(T[d])) {
      const stealF = STEAL.STEALF_BASE + STEAL.STEALF_K * n(LEGENDS[d].ratings.steal);   // Jordan's row before hawk
      const handleF = STEAL.HANDLEF_BASE - STEAL.HANDLEF_K * n(LEGENDS[h].ratings.ballHandle);
      const human = clamp(STEAL.S0_HUMAN * stealF * handleF, STEAL.P_MIN, STEAL.P_MAX);
      const cpu = clamp(DIFFICULTY.normal.cpuStealS0 * stealF * handleF, STEAL.P_MIN, STEAL.P_MAX);
      near(human, T[d][h][0], 0.006, `${d} pokes ${h} (human)`);
      near(cpu, T[d][h][1], 0.006, `${d} pokes ${h} (cpu)`);
    }
  }
  assert.deepEqual([STEAL.SIDE_NEAR, STEAL.SIDE_FAR, STEAL.EXPOSED, STEAL.PROTECT, STEAL.BEHIND], [1.15, 0.55, 1.25, 0.60, 0.80]);
  assert.deepEqual([STEAL.STUN, STEAL.STUN_REPEAT, STEAL.REPEAT_WINDOW, STEAL.COOLDOWN_HUMAN, STEAL.LIVE_GRACE, STEAL.CATCH_GRACE], [0.30, 0.55, 3.0, 0.8, 0.8, 0.5]);
});

check('passes, interceptions, strength, post, rebounds, moves, shakes, jab, pump fake, triggers (§5.5–§5.8)', () => {
  assert.deepEqual([PASS.RANGE, PASS.MIN_FLIGHT, PASS.LOB_HOLD, PASS.LOB_APEX, PASS.BEYOND_SPEED, PASS.BEYOND_SIGMA], [9.5, 0.25, 0.30, 1.8, 10, 1.6]);
  assert.deepEqual([PASS.BOUNCE_ADD, PASS.LOB_ADD, PASS.OVERHEAD_ADD, PASS.PUSH1, PASS.YAO_OVERHEAD], [0.02, 0.06, 0.08, 0.08, 0.25]);
  assert.deepEqual([INTERCEPT.R_ADD, INTERCEPT.P_BASE, INTERCEPT.P_K, INTERCEPT.P_DIST_K, INTERCEPT.P_MIN, INTERCEPT.P_MAX, INTERCEPT.DEFLECT_V], [0.05, 0.35, 0.45, 0.15, 0.15, 0.85, 0.35]);
  assert.deepEqual([STRENGTH.KEEP_BASE, STRENGTH.KEEP_K, STRENGTH.KEEP_MASS, STRENGTH.PUSH_BASE, STRENGTH.PUSH_K, STRENGTH.STUN_DIFF], [0.55, 0.006, 0.25, 0.10, 0.008, 20]);
  assert.deepEqual([POST.ENTRY_D, POST.HOLD, POST.SHOVE_T, POST.FACE_UP_T, POST.IDLE_T], [5.0, 0.35, 0.30, 0.35, 3.5]);
  assert.deepEqual([REBOUND.BOX_R, REBOUND.BOX_T, REBOUND.RAND_MAX, REBOUND.PUTBACK_REACH], [2.0, 0.4, 0.20, 3.15]);
  const mv = (id) => [MOVES_V2[id].imm ? [...MOVES_V2[id].imm] : null, MOVES_V2[id].moveMul, MOVES_V2[id].ankle, MOVES_V2[id].cooldown];
  assert.deepEqual(mv('move.cross'), [[0.05, 0.30], 1.0, true, 0.9]);
  assert.deepEqual(mv('sig.kyrie.hesiCross'), [[0.05, 0.40], 1.2, true, 0.9]);
  assert.deepEqual(mv('move.btl'), [[0.05, 0.28], 0.8, false, 0.7]);
  assert.deepEqual(mv('move.btb'), [[0.06, 0.30], 0.9, false, 0.8]);
  assert.deepEqual(mv('move.spin'), [[0.08, 0.40], 1.0, false, 1.0]);
  assert.deepEqual(mv('move.hesi'), [null, 0.9, false, 0.8]);
  assert.deepEqual(mv('move.stepback'), [[0.08, 0.36], 0.7, false, 0.9]);
  assert.deepEqual(mv('sig.kyrie.doubleBtlStepback'), [[0.05, 0.60], 1.1, true, 1.0]);
  assert.deepEqual([SHAKE.FALLEN_T, SHAKE.FALL_T + SHAKE.GROUND_T + SHAKE.GETUP_T, SHAKE.STUN_T, SHAKE.SLIDE], [1.60, 1.60, 0.40, 0.30]);
  assert.deepEqual([JAB.BITE_R, JAB.SAG_P, JAB.SAG_A, JAB.LUNGE_STUN, JAB.MAX_PER_HOLD], [1.6, 0.55, 0.5, 0.35, 2]);
  assert.deepEqual([PUMP_FAKE.TAP_MAX, PUMP_FAKE.UP_UNDER_WINDOW, PUMP_FAKE.UP_UNDER_D], [0.12, 0.6, 3.0]);
  assert.deepEqual([TRIGGERS.FT_DUNK.D_MIN, TRIGGERS.FT_DUNK.D_MAX, TRIGGERS.FT_DUNK.SPEED, TRIGGERS.FT_DUNK.MAX_PER_GAME], [6.0, 7.6, 6.0, 2]);
  assert.deepEqual([TRIGGERS.EURO.D_MIN, TRIGGERS.EURO.D_MAX, TRIGGERS.EURO_GENERIC.D_MIN, TRIGGERS.EURO_GENERIC.D_MAX], [5.4, 7.6, 3.0, 5.2]);
  assert.deepEqual([TRIGGERS.LONG_GATHER.D_MIN, TRIGGERS.LONG_GATHER.D_MAX, TRIGGERS.LONG_GATHER.SPEED], [6.4, 7.8, 5.0]);
  assert.deepEqual([TRIGGERS.LAYUP.STD1_MAX, TRIGGERS.LAYUP.STD2_MAX, TRIGGERS.LAYUP.STD2_MAX_JORDAN], [2.5, 4.0, 4.6]);
  assert.equal(RULES_V2.ASSIST_WINDOW, 3.0);
});

// ------------------------------------------------------------------------------------------------ rule fixtures (model level)

check('R1 (C1, S8 geometry): points by the feet at the release step', () => {
  const R = LINES.THREE_R;
  // sprinting shooter: press 0.1 m outside, release 0.4 m inside → 2; stationary 0.1 m outside → 3
  assert.equal(shotPoints('jumper', 0, RIM.z + R - 0.3), 2);
  assert.equal(shotPoints('jumper', 0, RIM.z + R + 0.1), 3);
  assert.equal(shotPoints('jumper', -6.75, -13.5), 3);   // corner three
  assert.equal(shotPoints('layup', 0, RIM.z + R + 0.1), 2);
});

check('R5 / R6 bookkeeping: a blocked three that drops keeps 3; STL credited at the defensive catch of a floor-bounced pass', () => {
  const m = new Metrics();
  m.gameStart({ a: ['lebron', 'kyrie', 'giannis'], b: ['jordan', 'kobe', 'yao'], user: 'a', kits: 'auto' });
  m.possessionStart(0);
  m.catchBall('kyrie', 0, 10.0, null);
  m.press('kyrie', 11.0, 9);
  m.shot({ t: 11.4, shooter: 'kyrie', team: 0, kind: 'jumper', zone: 'three', d: 7.4, three: true, points: 3, eT: 0, X: 0.3, C: 0.83, p: 0.6, make: true });
  m.block('yao', 1, 0);
  const ast = m.score('kyrie', 0, 3, 'jumper');      // the deflected ball still drops: the shot's 3 points count
  assert.equal(ast, null);
  m.possessionEnd('MADE');
  const s = m.snapshot();
  assert.equal(s.team[0].pts, 3); assert.equal(s.team[0].pm3, 1); assert.equal(s.team[0].zone.three.m, 1);
  assert.equal(s.team[1].blk, 1);
  assert.equal(s.shots[0].blockedBy, 'yao'); assert.equal(s.shots[0].scored, true);
  assert.deepEqual(s.possessions[0], { team: 0, liveSec: 0, end: 'MADE', points: 3 });
  // R6: a floor-bounced pass of team 1 caught by team 0's defender = STL for team 0 and a turnover (intercept) for team 1
  m.possessionStart(1);
  m.pass(1);
  m.steal('lebron', 0, 'pass');
  m.possessionEnd('TURNOVER');
  const s2 = m.snapshot();
  assert.equal(s2.team[0].stl, 1); assert.equal(s2.team[1].tov.intercept, 1); assert.equal(s2.team[1].passes, 1);
  assert.equal(s2.team[0].dreb + s2.team[0].oreb, 0);
});

// ------------------------------------------------------------------------------------------------ metrics.js

check('Metrics: assists (C27) within 3.0 s of the catch, no possession change, tips excluded', () => {
  const m = new Metrics();
  m.gameStart({ a: ['lebron', 'kyrie', 'giannis'], b: ['jordan', 'kobe', 'yao'], user: 'a', kits: 'auto' });
  m.possessionStart(0);
  m.pass(0);
  m.catchBall('kyrie', 0, 5.0, 'lebron');
  m.press('kyrie', 7.9, 10);
  m.shot({ t: 8.3, shooter: 'kyrie', team: 0, kind: 'jumper', zone: 'mid', d: 5, points: 2, make: true });
  assert.equal(m.score('kyrie', 0, 2, 'jumper'), 'lebron');
  m.possessionEnd('MADE');
  m.possessionStart(0);
  m.catchBall('giannis', 0, 20.0, 'kyrie');
  m.press('giannis', 23.1, 10);                        // 3.1 s after the catch: no assist
  m.shot({ t: 23.5, shooter: 'giannis', team: 0, kind: 'dunk', zone: 'dunk', d: 1, points: 2, make: true, fromDrive: true });
  assert.equal(m.score('giannis', 0, 2, 'dunk'), null);
  m.possessionEnd('MADE');
  m.possessionStart(0);
  m.catchBall('giannis', 0, 30.0, 'lebron');
  m.press('giannis', 30.5, 10);
  m.shot({ t: 30.8, shooter: 'giannis', team: 0, kind: 'tip', zone: 'close', d: 0.5, points: 2, make: true });
  assert.equal(m.score('giannis', 0, 2, 'tip'), null);   // tips excluded
  m.possessionEnd('MADE');
  // a possession change clears the chain
  m.possessionStart(0);
  m.catchBall('kyrie', 0, 40.0, 'lebron');
  m.possessionEnd('TURNOVER');
  m.possessionStart(0);
  m.press('kyrie', 41.0, 10);
  m.shot({ t: 41.2, shooter: 'kyrie', team: 0, kind: 'layup', zone: 'layup', d: 1.2, points: 2, make: true });
  assert.equal(m.score('kyrie', 0, 2, 'layup'), null);
  const s = m.snapshot();
  assert.equal(s.player.lebron.assists, 1);
  assert.equal(s.team[0].zone.rim.a, 3);               // dunk + tip + layup
  assert.equal(s.team[0].drivesFinished, 1);
});

check('Metrics: catchToPress (non-urgent only), release speeds, zones, schema of snapshot()', () => {
  const m = new Metrics();
  m.gameStart({ a: ['lebron', 'kyrie', 'giannis'], b: ['jordan', 'kobe', 'yao'], user: 'b', kits: 'auto' });
  m.possessionStart(1);
  m.catchBall('kobe', 1, 3.0, 'jordan');
  near(m.press('kobe', 3.62, 9.0), 0.62, 1e-12);
  m.catchBall('kobe', 1, 5.0, 'jordan');
  assert.ok(Number.isNaN(m.press('kobe', 5.3, 1.9)));   // urgent (shot clock ≤ 2 s): not booked
  assert.ok(Number.isNaN(m.press('yao', 6.0, 10)));     // no catch armed
  m.shot({ t: 4.0, shooter: 'kobe', team: 1, kind: 'fade', zone: 'mid', d: 4.6, points: 2, make: false, releaseSpeed: 1.1 });
  m.shot({ t: 9.0, shooter: 'kobe', team: 1, kind: 'stepback', zone: 'three', d: 7.6, three: true, points: 3, make: false, releaseSpeed: 0.4 });
  m.missResolved(1, true, true, false);
  m.liveTick(4.5);
  m.possessionEnd('SHOT_CLOCK');
  m.turnover(1, 'shotClock');
  m.turnover(1, 'backcourt');
  m.rebound('giannis', 0, false);
  m.ankle(0);
  m.move('kyrie'); m.jab('kobe'); m.pumpFake('kobe'); m.postTouch('yao'); m.handlerPossession('kyrie');
  m.drive('lebron', true, 10); m.drive('lebron', false, 10.6);
  m.ability('kobe.tough', 'kobe');
  m.addGameTime(12);
  const s = m.snapshot();
  assert.deepEqual(Object.keys(s), ['games', 'gameSeconds', 'possessions', 'team', 'player', 'shots']);
  assert.equal(s.games, 1); assert.equal(s.gameSeconds, 12);
  assert.deepEqual(s.possessions, [{ team: 1, liveSec: 4.5, end: 'SHOT_CLOCK', points: 0 }]);
  const T = s.team[1];
  for (const k of ['fga', 'fgm', 'pa3', 'pm3', 'zone', 'drivesFinished', 'blk', 'stl', 'tov', 'pts', 'passes', 'intercepts',
    'deflects', 'oreb', 'dreb', 'ankles', 'airballs', 'airballOOB', 'untouchedMiss', 'untouchedMissOOB']) assert.ok(k in T, k);
  assert.deepEqual(Object.keys(T.tov), ['steal', 'intercept', 'oob', 'shotClock', 'notCleared']);
  assert.deepEqual(Object.keys(T.zone), ['rim', 'close', 'mid', 'three']);
  assert.equal(T.fga, 2); assert.equal(T.pa3, 1); assert.equal(T.zone.mid.a, 1); assert.equal(T.zone.three.a, 1);
  assert.equal(T.tov.shotClock, 1); assert.equal(T.tov.oob, 1); assert.equal(T.airballs, 1); assert.equal(T.untouchedMiss, 1);
  assert.equal(s.team[0].dreb, 1); assert.equal(s.team[0].ankles, 1);
  const K = s.player.kobe;
  for (const k of ['fga', 'fgm', 'zone', 'pa3', 'moves', 'jabs', 'pumpFakes', 'postTouches', 'touches', 'handlerPossessions',
    'assists', 'catchToPress', 'releaseSpeed', 'abilities']) assert.ok(k in K, k);
  assert.deepEqual(K.catchToPress.map((x) => Math.round(x * 100) / 100), [0.62]);
  assert.deepEqual(K.releaseSpeed, [1.1, 0.4]);
  assert.equal(K.jumpers, 2); assert.equal(K.stepbacks, 1); assert.equal(K.touches, 2);
  assert.deepEqual(K.abilities, { 'kobe.tough': 1 });
  assert.equal(s.player.lebron.drives, 1);
  assert.equal(s.player.kyrie.moves, 1); assert.equal(s.player.yao.postTouches, 1);
  assert.equal(s.shots.length, 2); assert.equal(s.shots[1].kind, 'stepback'); assert.equal(s.shots[1].zone, 'three');
  m.reset();
  const r = m.snapshot();
  assert.equal(r.games, 0); assert.equal(r.shots.length, 0); assert.equal(r.team[1].fga, 0); assert.equal(r.player.kobe.fga, 0);
});

check('Metrics: the shot ring keeps the last 2000, possessions ring keeps order', () => {
  const m = new Metrics({ shotCapacity: 2000 });
  for (let i = 0; i < 2100; i++) m.shot({ t: i, shooter: 'kyrie', team: 0, kind: 'jumper', zone: 'mid', d: 5, points: 2, make: false });
  const s = m.snapshot();
  assert.equal(s.shots.length, 2000); assert.equal(s.shots[0].t, 100); assert.equal(s.shots[1999].t, 2099);
  assert.equal(s.team[0].fga, 2100);
  assert.equal(Object.keys(ABILITY_IDS).length, 22);
});

// ------------------------------------------------------------------------------------------------ i18n API, source rules

check('i18n API sanity (zh default, same key sets, missing key falls back to the key)', () => {
  const zh = Object.keys(STRINGS.zh).sort(), en = Object.keys(STRINGS.en).sort();
  assert.deepEqual(zh, en);
  assert.equal(getLang(), 'zh');
  assert.equal(t('nope.missing'), 'nope.missing');
  setLang('en');
  assert.equal(getLang(), 'en');
  setLang('zh');
});

check('H6 / H8 source rules for the WP4a modules: no CJK outside legends.js, no Math.random, depth-correct imports only', () => {
  const CJK = /[　-〿㐀-鿿＀-￯]/;
  for (const f of ['constants.js', 'ratings.js', 'shot.js', 'abilities.js', 'lineup.js', 'metrics.js', 'legends.js']) {
    const code = readFileSync(path.join(HERE, '../src', f), 'utf8');
    if (f !== 'legends.js') assert.ok(!CJK.test(code), f + ' contains CJK');
    assert.ok(!/Math\.random/.test(code), f + ' uses Math.random');
    for (const m of code.matchAll(/from\s+'([^']+)'/g)) assert.ok(m[1].startsWith('./'), f + ' imports ' + m[1]);
    assert.ok(code.split('\n').length <= 1600, f + ' too long');
  }
});

console.log(passed + ' checks passed');
