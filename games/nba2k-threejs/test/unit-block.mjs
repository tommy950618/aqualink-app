// Unit checks for the v2 block model (spec §5.4, GP §4, C2, C8): the §4.3 probability table through `blockChance`,
// ability multipliers, windows, the game-level eligibility of `tryBlocks` (palm socket within rHand, rising ball,
// window, not behind, one roll per defender per shot), success effects (loose ball, BLK, event, caption, R2 touched),
// LeBron's chase-down (from behind, rHand 0.36, window 0.40, B0 0.50 / cap 0.55, pin), dunk stuffs and dunk rim-outs
// (R11), and the S7 forced-contact rate through `debugBlock`.
// Run: node test/unit-block.mjs
import assert from 'node:assert/strict';
import { Game, blockChance } from '../src/game.js';
import { BLOCK, DIFFICULTY, RIM, BOARD } from '../src/constants.js';
import { LEGENDS } from '../src/legends.js';
import { n } from '../src/ratings.js';
import { SOCK } from '../src/anim/rig.js';
import { clipIndex } from '../src/anim/clip.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (±${tol})`);
const FROZEN_AI = { updateAI() {} };

/** A game in LIVE with a no-op AI (players only move when the test moves them). */
function liveGame(seed = 1, extra = {}) {
  const g = new Game(Object.assign({ scene: null, anim: 'proxy', seed, quarterSec: 120, ai: FROZEN_AI, auto: true }, extra));
  g.start({});
  for (let i = 0; i < 80 && g.state !== 'LIVE'; i++) g.step(1 / 60);
  assert.equal(g.state, 'LIVE');
  return g;
}

/** Puts the offence on `team` with `handler` (debug staging used by the hooks) and clears the court. */
function stage(g, handlerId) {
  const h = g.byId[handlerId];
  g.stageLive(h.team, h);
  return h;
}

/**
 * Makes defender `b` airborne at his apex next step with the palm (proxy: root + facing·0.30 + (0, reachM − 0.24 +
 * jumpY, 0) while a block clip plays) at `at` + (dx, 0, dz). The block clip is played for the socket rule; the state
 * stays neutral so the clip's own TAKEOFF does not restart the jump.
 */
function airborneAt(g, b, at, yaw, dx = 0, dz = 0) {
  b.playClip(clipIndex('def.block1'), null);
  b.state = 'idle';
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  g.teleport(b, at.x - fx * 0.30 + dx, at.z - fz * 0.30 + dz, yaw);
  const h = Math.max(0.05, at.y - (b.legend.stats.reachM - 0.24));
  b.startJump(h, 2 * Math.sqrt(2 * h / 9.81), null, 'block', 0);
  b.jumpT = b.jumpAir / 2 - 1 / 60;
  b.jumpY = b.jumpAt(b.jumpT);
}

function stepUntil(g, pred, max = 240) {
  for (let i = 0; i < max; i++) { if (pred()) return true; g.step(1 / 60); }
  return pred();
}

// Table GP §4.3 [M]: jumper / close / layup / dunk (human blocker, normal, before ability multipliers).
const TABLE = {
  kobe: { jordan: [0.19, 0.22, 0.25, 0.14], lebron: [0.18, 0.21, 0.24, 0.13], giannis: [0.18, 0.20, 0.23, 0.13], yao: [0.15, 0.18, 0.21, 0.11], kyrie: [0.20, 0.24, 0.27, 0.15] },
  jordan: { kobe: [0.24, 0.28, 0.31, 0.17], lebron: [0.22, 0.26, 0.30, 0.16], giannis: [0.22, 0.25, 0.29, 0.16], yao: [0.19, 0.22, 0.25, 0.14], kyrie: [0.25, 0.29, 0.33, 0.18] },
  lebron: { kobe: [0.29, 0.34, 0.38, 0.21], jordan: [0.29, 0.34, 0.38, 0.21], giannis: [0.27, 0.31, 0.35, 0.19], yao: [0.23, 0.27, 0.31, 0.17], kyrie: [0.30, 0.36, 0.41, 0.22] },
  giannis: { kobe: [0.30, 0.40, 0.45, 0.26], jordan: [0.30, 0.40, 0.45, 0.26], lebron: [0.30, 0.39, 0.44, 0.24], yao: [0.29, 0.33, 0.38, 0.21], kyrie: [0.30, 0.40, 0.45, 0.27] },
  yao: { kobe: [0.30, 0.40, 0.45, 0.30], jordan: [0.30, 0.40, 0.45, 0.30], lebron: [0.30, 0.40, 0.45, 0.29], giannis: [0.30, 0.40, 0.45, 0.29], kyrie: [0.30, 0.40, 0.45, 0.30] },
  kyrie: { kobe: [0.13, 0.15, 0.17, 0.10], jordan: [0.13, 0.15, 0.17, 0.10], lebron: [0.12, 0.14, 0.17, 0.09], giannis: [0.12, 0.14, 0.16, 0.09], yao: [0.10, 0.12, 0.14, 0.08] },
};
const COLS = [['jumper', 'mid'], ['jumper', 'close'], ['layup', 'layup'], ['dunk', 'dunk']];

check('§4.3 table: blockChance reproduces every cell before ability multipliers (±0.006)', () => {
  const g = liveGame();
  let cells = 0;
  for (const b of Object.keys(TABLE)) {
    for (const s of Object.keys(TABLE[b])) {
      COLS.forEach(([kind, zone], k) => {
        const B = blockChance(g.byId[s], g.byId[b], kind, { zone, side: 'human', difficulty: 'normal' });
        const pre = Math.min(B.cap, B.B0 * B.blkF * B.hAdv);
        near(pre, TABLE[b][s][k], 0.006, `${b} blocks ${s} ${kind}/${zone}`);
        // the full roll is the same product with the ability multiplier inside the cap, × the side multiplier
        near(B.pB, Math.min(B.cap, B.B0 * B.blkF * B.hAdv * B.abilityMul) * B.sideMul, 1e-12, 'pB formula');
        cells++;
      });
    }
  }
  assert.equal(cells, 120);
});

check('blkF / hAdv factors, caps and the difficulty side multipliers (§5.4, §5.11)', () => {
  const g = liveGame();
  const B = blockChance(g.byId.kyrie, g.byId.yao, 'jumper', { zone: 'mid', side: 'human', difficulty: 'normal' });
  near(B.blkF, 0.35 + 0.85 * n(LEGENDS.yao.ratings.block), 1e-12);
  near(B.hAdv, Math.min(1.35, 1 + 0.625 * (2.29 - 1.88)), 1e-12, 'hAdv = clamp(1 + 0.625·(H_def − H_sh), 0.60, 1.35)');
  const B2 = blockChance(g.byId.yao, g.byId.kyrie, 'jumper', { zone: 'mid', side: 'human', difficulty: 'normal' });
  near(B2.hAdv, Math.max(0.60, 1 + 0.625 * (1.88 - 2.29)), 1e-12);
  assert.equal(B.cap, 0.30);
  for (const d of ['easy', 'normal', 'hard']) {
    const D = DIFFICULTY[d];
    near(blockChance(g.byId.kobe, g.byId.jordan, 'jumper', { zone: 'mid', side: 'human', difficulty: d }).sideMul, D.userBlockMul, 0);
    near(blockChance(g.byId.kobe, g.byId.jordan, 'jumper', { zone: 'mid', side: 'cpu', difficulty: d }).sideMul, D.cpuBlockMul, 0);
    near(blockChance(g.byId.kobe, g.byId.jordan, 'jumper', { zone: 'mid', side: 'mate', difficulty: d }).sideMul, 1, 0);
    near(blockChance(g.byId.kobe, g.byId.jordan, 'jumper', { zone: 'mid', side: 'auto', difficulty: d }).sideMul, 1, 0);
  }
});

check('ability multipliers: Kyrie finisher, Yao highRelease / hook, Giannis help & longDunk, Yao anchor, Jordan switch', () => {
  const g = liveGame();
  const P = g.byId;
  near(blockChance(P.kyrie, P.kobe, 'layup', { zone: 'layup' }).abilityMul, 0.55, 1e-12, 'kyrie finisher');
  near(blockChance(P.kyrie, P.kobe, 'jumper', { zone: 'mid' }).abilityMul, 1, 1e-12);
  near(blockChance(P.yao, P.kobe, 'jumper', { zone: 'mid' }).abilityMul, 0.60, 1e-12, 'yao highRelease vs H < 2.05');
  near(blockChance(P.yao, P.giannis, 'jumper', { zone: 'mid' }).abilityMul, 1, 1e-12, 'no highRelease vs Giannis 2.11');
  const hk = blockChance(P.yao, P.kyrie, 'hook', { zone: 'close' });
  assert.equal(hk.eligible, false, 'Yao hook: H < 2.05 may not block');
  assert.equal(hk.pB, 0);
  const hk2 = blockChance(P.yao, P.giannis, 'hook', { zone: 'close' });
  assert.equal(hk2.eligible, true);
  near(hk2.B0, BLOCK.B0.hook * 0.5, 1e-12, 'B0 × 0.5 vs the Yao hook');
  near(blockChance(P.kobe, P.giannis, 'jumper', { zone: 'mid', help: true }).abilityMul, 1.25, 1e-12, 'giannis help');
  near(blockChance(P.kobe, P.giannis, 'jumper', { zone: 'mid', help: true }).rHand, BLOCK.R_HAND_BIG, 1e-12);
  near(blockChance(P.giannis, P.kobe, 'dunk', { variant: 'longGather', zone: 'dunk', dunk: true }).abilityMul, 0.60, 1e-12, 'longDunk stuff');
  near(blockChance(P.jordan, P.kobe, 'layup', { variant: 'switch', zone: 'layup' }).abilityMul, 0.40, 1e-12, 'Jordan air switch');
  // Yao anchor: ×1.20 and rHand 0.34 only within 2.0 m of the rim
  g.teleport('yao', RIM.x + 0.5, RIM.z + 1.5, 0);
  const an = blockChance(P.kobe, P.yao, 'layup', { zone: 'layup' });
  near(an.abilityMul, 1.20, 1e-12); near(an.rHand, 0.34, 1e-12);
  g.teleport('yao', RIM.x + 0.5, RIM.z + 3.0, 0);
  near(blockChance(P.kobe, P.yao, 'layup', { zone: 'layup' }).abilityMul, 1, 1e-12);
});

check('windows (releaseAge): jumper family 0.22, close / hook / floater 0.26, layup 0.30, chase-down layup 0.40', () => {
  const g = liveGame();
  const P = g.byId;
  for (const k of ['jumper', 'fade', 'stepback', 'turnFade']) near(blockChance(P.kobe, P.jordan, k, { zone: 'mid' }).window, 0.22, 1e-12, k);
  near(blockChance(P.kobe, P.jordan, 'jumper', { zone: 'close' }).window, 0.26, 1e-12, 'close jumper');
  near(blockChance(P.kobe, P.jordan, 'hook', { zone: 'close' }).window, 0.26, 1e-12);
  near(blockChance(P.kobe, P.jordan, 'floater', { zone: 'close' }).window, 0.26, 1e-12);
  near(blockChance(P.kobe, P.jordan, 'layup', { zone: 'layup' }).window, 0.30, 1e-12);
  const ch = blockChance(P.kobe, P.lebron, 'layup', { zone: 'layup', chasing: true });
  assert.ok(ch.chase && ch.behindOK && ch.pin);
  near(ch.window, 0.40, 1e-12); near(ch.rHand, 0.36, 1e-12); near(ch.B0, 0.50, 1e-12); near(ch.cap, 0.55, 1e-12);
  // a chase-down of a jumper is not a chase
  assert.equal(blockChance(P.kobe, P.lebron, 'jumper', { zone: 'mid', chasing: true }).chase, false);
});

/**
 * Release a set shot by `shooterId` from (x, z), wait for the launch, then put `blockerId`'s palm `off` metres beside
 * the ball (airborne at his apex, in front of the shooter unless `behind`). Returns { g, s, b }.
 */
function blockSetup(opts) {
  const g = liveGame(opts.seed || 3);
  const s = stage(g, opts.shooter || 'kobe');
  g.teleport(s, opts.x || 0, opts.z || -8.3, Math.PI);
  g.debugShoot({ shooter: s.id, eT: 0, p: 0, kind: opts.kind, variant: opts.variant });
  assert.ok(stepUntil(g, () => g.ball.state === 'flight'), 'shot launched');
  const b = g.byId[opts.blocker || 'kyrie'];
  assert.notEqual(b.team, s.team, 'blocker must defend the shooter');
  // in front: facing the shooter (+z) from the rim side; behind: facing the rim from the shooter's back
  airborneAt(g, b, g.ball.pos, opts.behind ? Math.PI : 0, opts.off || 0, 0);
  return { g, s, b };
}

check('tryBlocks eligibility: palm within rHand rolls once; 0.31 m does not; descending / late / stunned / behind do not', () => {
  // in reach: rolled exactly once
  let T = blockSetup({ off: 0.05 });
  T.g.step(1 / 60);
  assert.equal(T.g.blockRolled[T.b.idx], 1, 'rolled');
  T.g.blockRolled[T.b.idx] = 1;
  // out of reach (0.31 m sideways at the same height): no roll
  T = blockSetup({ off: 0.31 + 0.02 });
  T.g.step(1 / 60);
  assert.equal(T.g.blockRolled[T.b.idx], 0, 'no roll beyond rHand');
  // stunned blocker: no roll
  T = blockSetup({ off: 0.05 });
  T.b.state = 'stunned'; T.b.stunT = 1;
  T.g.step(1 / 60);
  assert.equal(T.g.blockRolled[T.b.idx], 0, 'stunned');
  // behind the shooter (dot < −0.20): no roll for a jump shot
  T = blockSetup({ off: 0.05, behind: true });
  const sh = T.s;
  T.g.teleport(sh, sh.pos.x, T.g.ball.pos.z - 0.9, Math.PI);   // the shooter now stands between the ball and the rim side
  T.g.step(1 / 60);
  assert.equal(T.g.blockRolled[T.b.idx], 0, 'behind');
  // late: past the 0.22 s window
  T = blockSetup({ off: 0.05 });
  T.g.ball.releaseAge = 0.23;
  T.g.step(1 / 60);
  assert.equal(T.g.blockRolled[T.b.idx], 0, 'window');
  // descending ball
  T = blockSetup({ off: 0.05 });
  T.g.ball.vel.y = -0.5;
  T.g.step(1 / 60);
  assert.equal(T.g.blockRolled[T.b.idx], 0, 'descending');
});

check('block success: loose ball pushed back, BLK, block event + cap.block, shot.touched (R2), no cap.miss', () => {
  const T = blockSetup({ off: 0.05 });
  const { g, s, b } = T;
  const ev = [];
  g.on('*', (e, t) => ev.push({ t, key: e.key, blockerId: e.blockerId, shooterId: e.shooterId }));
  const vz0 = g.ball.vel.z;
  const next = g.rng.next;
  g.rng.next = () => 0;                              // the roll succeeds
  g.step(1 / 60);
  g.rng.next = next;
  assert.equal(g.ball.state, 'loose');
  assert.equal(b.stats.blk, 1);
  assert.ok(g.ball.shot.touched && g.ball.shot.blocked);
  assert.equal(g.ball.lastToucher, b);
  assert.ok(Math.sign(g.ball.vel.z) !== Math.sign(vz0) || Math.abs(g.ball.vel.z) < Math.abs(vz0), 'pushed back (−0.30·vz)');
  assert.ok(g.ball.vel.y >= 2.0 - 9.81 / 60 - 0.01, 'lifted 2.0 + 1.5·U m/s (one gravity step later)');
  const blk = ev.find((e) => e.t === 'block');
  assert.ok(blk && blk.blockerId === b.id && blk.shooterId === s.id);
  assert.ok(ev.some((e) => e.t === 'caption' && e.key === 'cap.block'));
  for (let i = 0; i < 60; i++) g.step(1 / 60);
  assert.ok(!ev.some((e) => e.t === 'caption' && e.key === 'cap.miss'), 'a blocked shot is not captioned as a miss');
  assert.equal(g.metrics.snapshot().team[b.team].blk, 1);
});

check('chase-down: LeBron from behind on a layup — eligible, rHand 0.36, pin to the board, cap.chaseDown', () => {
  const g = liveGame(5);
  const s = stage(g, 'kobe');
  // LeBron must be on the other team for this check
  assert.notEqual(g.byId.lebron.team, s.team);
  g.teleport(s, 0.2, RIM.z + 1.8, Math.PI);
  const L = g.byId.lebron;
  g.teleport(L, 0.2, RIM.z + 4.3, Math.PI);
  g.debugShoot({ shooter: 'kobe', kind: 'layup', variant: 'std', eT: 0, p: 0 });
  assert.equal(g.abilityLog.count('lebron.chaseDown'), 1, 'chase-down triggered at the layup start');
  assert.ok(L.chaseT > 0 && L.chaseShooter === s);
  assert.ok(stepUntil(g, () => g.ball.state === 'flight'), 'layup released');
  // move the rising ball near the board (pin rule: within 1.2 m), the shooter under it, LeBron behind him with the
  // palm 0.33 m from the ball: inside the chase radius 0.36, outside the generic 0.30
  const ball = g.ball;
  ball.pos.z = BOARD.max.z + 0.8;
  g.teleport(s, ball.pos.x, ball.pos.z + 0.25, Math.PI);
  airborneAt(g, L, ball.pos, Math.PI, 0, 0.33);
  L.chaseShooter = s;
  const ev = [];
  g.on('*', (e, t) => ev.push({ t, key: e.key, pin: e.pin, chaseDown: e.chaseDown }));
  const next = g.rng.next;
  g.rng.next = () => 0;
  g.step(1 / 60);
  g.rng.next = next;
  const blk = ev.find((e) => e.t === 'block');
  assert.ok(blk, 'blocked from behind');
  assert.equal(blk.chaseDown, true);
  assert.ok(ev.some((e) => e.t === 'caption' && e.key === 'cap.chaseDown'));
  assert.equal(blk.pin, true, 'pinned near the board');
  near(g.ball.vel.z, BLOCK.PIN_V.z * (1 - 0.02 / 60), 0.2, 'pin velocity toward the board');
});

check('S7: forced contact via debugBlock — observed block rate within ±0.05 of the formula (n 400 per pair)', () => {
  const g = liveGame(7);
  const pairs = [['lebron', 'kobe', 'jumper'], ['yao', 'kyrie', 'layup'], ['kyrie', 'yao', 'jumper'], ['giannis', 'jordan', 'layup']];
  for (const [b, s, kind] of pairs) {
    let hits = 0, pB = 0;
    for (let i = 0; i < 400; i++) { const r = g.debugBlock({ blocker: b, shooter: s, kind, contact: true }); assert.ok(r.eligible); pB = r.pB; if (r.blocked) hits++; }
    near(hits / 400, pB, 0.05, `${b} vs ${s} ${kind}`);
  }
  assert.equal(g.debugBlock({ blocker: 'kyrie', shooter: 'yao', kind: 'hook', contact: true }).eligible, false, 'Yao hook vs a short blocker');
});

check('dunk stuff (rising phase, B0 0.22 / cap 0.30): the dunk aborts into a drop, ball pops loose, BLK', () => {
  const g = liveGame(9);
  const s = stage(g, 'lebron');
  g.teleport(s, 0, RIM.z + 1.2, Math.PI);
  s.sprintRecentT = 0.3;
  g.debugShoot({ shooter: 'lebron', kind: 'dunk', variant: 'power2', p: 1 });
  assert.equal(s.shot.kind, 'dunk');
  assert.ok(stepUntil(g, () => s.isJumping), 'takeoff');
  g.step(1 / 60);
  const b = g.byId.yao.team !== s.team ? g.byId.yao : g.byId.giannis;
  g.byId.yao.team !== s.team || assert.fail('Yao must defend LeBron in the default lineup');
  const ballAt = { x: 0, y: 0, z: 0 };
  s.animator.querySocket(SOCK.ball, ballAt);
  airborneAt(g, b, ballAt, 0, 0, -0.05);
  const B = blockChance(s, b, 'dunk', { zone: 'dunk', dunk: true, side: 'auto' });
  near(B.B0, BLOCK.DUNK_B0, 1e-12); near(B.cap, BLOCK.DUNK_CAP, 1e-12);
  const next = g.rng.next;
  g.rng.next = () => 0;
  g.step(1 / 60);
  g.rng.next = next;
  assert.equal(g.ball.state, 'loose', 'stuffed');
  near(g.ball.vel.y, BLOCK.STUFF_UP - 9.81 / 60, 0.2);
  assert.equal(b.stats.blk, 1);
  assert.ok(s.shot.slamDone);
  assert.ok(stepUntil(g, () => !s.isJumping, 120), 'the dunker drops');
});

check('dunk rim-out (R11): a failed slam roll pops the ball out (0.6·fwd, 3.0), cap.rimOut, miss event', () => {
  const g = liveGame(11);
  const s = stage(g, 'lebron');
  g.teleport(s, 0, RIM.z + 1.2, Math.PI);
  s.sprintRecentT = 0.3;
  g.debugShoot({ shooter: 'lebron', kind: 'dunk', variant: 'power2', p: 0 });
  const ev = [];
  g.on('*', (e, t) => ev.push({ t, key: e.key, what: e.what }));
  assert.ok(stepUntil(g, () => s.shot.slamDone, 120), 'slam');
  assert.ok(ev.some((e) => e.t === 'slam' && e.what === 'rimOut'));
  assert.ok(ev.some((e) => e.t === 'caption' && e.key === 'cap.rimOut'));
  assert.ok(ev.some((e) => e.t === 'miss'));
  assert.equal(g.ball.state, 'loose');
  assert.ok(g.ball.shot.touched, 'a rim-out touched the rim (R2)');
  assert.equal(g.score[s.team], 0);
  // and with p = 1 the slam scores 2
  const g2 = liveGame(12);
  const s2 = stage(g2, 'lebron');
  g2.teleport(s2, 0, RIM.z + 1.2, Math.PI);
  g2.debugShoot({ shooter: 'lebron', kind: 'dunk', variant: 'power2', p: 1 });
  assert.ok(stepUntil(g2, () => g2.score[s2.team] > 0, 120), 'dunk scores');
  assert.equal(g2.score[s2.team], 2);
});

console.log(`unit-block: ${passed} checks passed`);
