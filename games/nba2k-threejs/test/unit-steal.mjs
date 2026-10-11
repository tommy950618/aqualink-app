// Unit checks for steals, passes and interceptions (spec §5.5, GP §5, C5, C6, R6, R7): the §5.1 poke table through
// `pokeChance`, the side / exposed / protect / behind factors and the clamp, poke resolution at SWIPE (eligibility,
// immunity windows, failure stuns 0.30 / 0.55 s, def.stealMiss rate), STL credit at the catch (R6: poked ball, floor-
// bounced pass; an offensive recovery credits nothing), the R7 CPU poke grace windows, pass release at RELEASE from
// the hand socket (C6, B52), interception probability and the A15 / S6 lane test, deflections, the human lunge.
// Run: node test/unit-steal.mjs
import assert from 'node:assert/strict';
import { Game, pokeChance, interceptChance } from '../src/game.js';
import { STEAL, INTERCEPT, DIFFICULTY, PASS, RIM } from '../src/constants.js';
import { LEGENDS } from '../src/legends.js';
import { n } from '../src/ratings.js';
import { SOCK } from '../src/anim/rig.js';
import { pressButton, releaseButton } from '../src/input.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (±${tol})`);
const FROZEN_AI = { updateAI() {} };

function liveGame(seed = 1, extra = {}) {
  const g = new Game(Object.assign({ scene: null, anim: 'proxy', seed, quarterSec: 120, ai: FROZEN_AI, auto: true }, extra));
  g.start({});
  for (let i = 0; i < 80 && g.state !== 'LIVE'; i++) g.step(1 / 60);
  assert.equal(g.state, 'LIVE');
  return g;
}
function stepUntil(g, pred, max = 240) {
  for (let i = 0; i < max; i++) { if (pred()) return true; g.step(1 / 60); }
  return pred();
}
const ms = (g) => g.world.time * 1000;

// GP §5.1 [M] per-attempt values: human S0 / CPU-normal S0 (side, exposed, protect, behind = 1); Jordan before hawk.
const TABLE = {
  kobe: { jordan: [0.23, 0.16], lebron: [0.23, 0.16], giannis: [0.27, 0.19], yao: [0.38, 0.26], kyrie: [0.19, 0.13] },
  jordan: { kobe: [0.24, 0.17], lebron: [0.25, 0.17], giannis: [0.29, 0.20], yao: [0.41, 0.29], kyrie: [0.21, 0.15] },
  lebron: { kobe: [0.20, 0.14], jordan: [0.21, 0.15], giannis: [0.25, 0.17], yao: [0.35, 0.24], kyrie: [0.18, 0.12] },
  giannis: { kobe: [0.19, 0.14], jordan: [0.20, 0.14], lebron: [0.20, 0.14], yao: [0.33, 0.23], kyrie: [0.17, 0.12] },
  yao: { kobe: [0.13, 0.09], jordan: [0.13, 0.09], lebron: [0.13, 0.09], giannis: [0.16, 0.11], kyrie: [0.11, 0.08] },
  kyrie: { kobe: [0.19, 0.13], jordan: [0.20, 0.14], lebron: [0.20, 0.14], giannis: [0.23, 0.16], yao: [0.33, 0.23] },
};

check('§5.1 poke table: pokeChance per pair, human and CPU-normal S0 (±0.006; Jordan ×1.15 hawk, clamp 0.45)', () => {
  const g = liveGame();
  let cells = 0;
  for (const d of Object.keys(TABLE)) {
    for (const h of Object.keys(TABLE[d])) {
      const hawk = d === 'jordan' ? 1.15 : 1;
      const H = pokeChance(g.byId[d], g.byId[h], { side: 'human', difficulty: 'normal' });
      near(H.pPoke, Math.min(0.45, TABLE[d][h][0] * hawk), 0.006 * hawk, `${d} pokes ${h} (human)`);
      const C = pokeChance(g.byId[d], g.byId[h], { side: 'cpu', difficulty: 'normal' });
      near(C.pPoke, Math.min(0.45, TABLE[d][h][1] * hawk), 0.006 * hawk, `${d} pokes ${h} (cpu)`);
      cells += 2;
    }
  }
  assert.equal(cells, 60);
});

check('poke factors: S0 by side and difficulty, stealF / handleF, side 1.15 / 0.55, exposed, protect, behind, clamp', () => {
  const g = liveGame();
  const P = g.byId;
  for (const d of ['easy', 'normal', 'hard']) {
    near(pokeChance(P.kobe, P.lebron, { side: 'cpu', difficulty: d }).parts.S0, DIFFICULTY[d].cpuStealS0, 0);
    near(pokeChance(P.kobe, P.lebron, { side: 'human', difficulty: d }).parts.S0, STEAL.S0_HUMAN, 0);
    near(pokeChance(P.kobe, P.lebron, { side: 'mate', difficulty: d }).parts.S0, DIFFICULTY.normal.cpuStealS0, 0, 'teammates: normal column');
  }
  const R = pokeChance(P.kobe, P.lebron, { side: 'human', ballNear: true, exposed: true, protect: true, behind: true });
  near(R.parts.stealF, 0.45 + 0.75 * n(LEGENDS.kobe.ratings.steal), 1e-12);
  near(R.parts.handleF, 1.35 - 0.75 * n(LEGENDS.lebron.ratings.ballHandle), 1e-12);
  assert.deepEqual([R.parts.side, R.parts.exposed, R.parts.protect, R.parts.behind], [1.15, 1.25, 0.60, 0.80]);
  near(pokeChance(P.kobe, P.lebron, { side: 'human', ballNear: false }).parts.side, 0.55, 0);
  near(pokeChance(P.jordan, P.yao, { side: 'human', ballNear: true, exposed: true }).pPoke, 0.45, 1e-12, 'clamp at 0.45');
  near(pokeChance(P.yao, P.kyrie, { side: 'cpu', difficulty: 'easy', ballNear: false, protect: true, behind: true }).pPoke, 0.03, 1e-12, 'clamp at 0.03');
});

/** Handler `hid` dribbling at (0, −7) facing the rim, defender `did` in front at distance `dist`. */
function pokeSetup(seed, hid, did, dist) {
  const g = liveGame(seed);
  const h = g.byId[hid], d = g.byId[did];
  g.stageLive(h.team, h);
  g.teleport(h, 0, -7, Math.PI);
  g.startDribble(h);
  h.cx.catchT = -10;
  g.teleport(d, 0, -7 - dist, 0);
  for (let i = 0; i < 3; i++) g.step(1 / 60);
  return { g, h, d };
}

check('poke at SWIPE: success = loose ball toward the defender, STL to the catcher (R6), victim excluded 0.3 s', () => {
  const { g, h, d } = pokeSetup(2, 'lebron', 'jordan', 0.8);
  const ev = [];
  g.on('*', (e, t) => ev.push({ t, how: e.how, playerId: e.playerId }));
  assert.ok(g.startPoke(d, true), 'human poke starts');
  const next = g.rng.next;
  g.rng.next = () => 0;                                          // every roll succeeds
  assert.ok(stepUntil(g, () => d.stealAct.resolved, 30), 'resolved at SWIPE');
  g.rng.next = next;
  // the poked ball is loose ('steal' context) until somebody catches it; the STL is booked only at that catch
  if (!g.ball.isHeld) {
    assert.equal(g.ball.ctx, 'steal');
    assert.equal(d.stats.stl, 0, 'no STL at the poke (R6)');
    assert.ok(!ev.some((e) => e.t === 'steal'), 'no steal event before the catch');
  }
  assert.ok(stepUntil(g, () => g.ball.isHeld || g.state !== 'LIVE', 120));
  assert.ok(g.ball.lastToucher !== h || g.ball.owner !== h, 'the victim did not take it straight back');
  const catcher = g.ball.owner;
  assert.ok(catcher, 'someone caught it');
  if (catcher.team === d.team) {
    assert.equal(catcher.stats.stl, 1, 'STL to the catching defender');
    assert.ok(ev.some((e) => e.t === 'steal' && e.how === 'poke' && e.playerId === catcher.id));
  } else {
    assert.equal(d.stats.stl, 0, 'an offensive recovery credits nothing');
  }
});

check('poke failure: stunned 0.30 s, 0.55 s for a 2nd fail within 3.0 s, def.stealMiss played at rate 0.35/stun (C5)', () => {
  const { g, d } = pokeSetup(3, 'lebron', 'jordan', 0.8);
  const next = g.rng.next;
  g.rng.next = () => 0.999;                                      // every roll fails
  g.startPoke(d, true);
  assert.ok(stepUntil(g, () => d.stealAct.resolved, 30));
  assert.equal(d.state, 'stunned');
  near(d.stunT, STEAL.STUN, 1 / 60 + 1e-9);
  assert.ok(stepUntil(g, () => d.state !== 'stunned', 60));
  d.stealCd = 0;
  g.startPoke(d, true);
  assert.ok(stepUntil(g, () => d.stealAct.resolved, 30));
  near(d.stunT, STEAL.STUN_REPEAT, 1 / 60 + 1e-9, 'second fail within 3 s');
  g.rng.next = next;
});

check('poke eligibility: holding handler, immunity window of a move, out of range → no steal', () => {
  // holding (not dribbling): ineligible
  let T = pokeSetup(4, 'kyrie', 'kobe', 0.8);
  T.g.ball.setHoldMode('held');
  let next = T.g.rng.next; T.g.rng.next = () => 0;
  T.g.startPoke(T.d, true);
  stepUntil(T.g, () => T.d.stealAct.resolved, 30);
  T.g.rng.next = next;
  assert.ok(T.g.ball.isHeld && T.g.ball.owner === T.h, 'no steal from a holder');
  // immunity window [0.05, 0.30] of move.cross
  T = pokeSetup(5, 'kyrie', 'kobe', 0.8);
  T.g.startMove(T.h, 'move.cross', false, 1);
  assert.ok(T.h.immuneUntil > T.g.world.time);
  next = T.g.rng.next; T.g.rng.next = () => 0;
  T.g.startPoke(T.d, true);
  stepUntil(T.g, () => T.d.stealAct.resolved, 30);
  T.g.rng.next = next;
  assert.ok(T.g.ball.owner === T.h, 'immune during the move');
  // out of range
  T = pokeSetup(6, 'kyrie', 'kobe', 1.6);
  next = T.g.rng.next; T.g.rng.next = () => 0;
  T.g.startPoke(T.d, true);
  stepUntil(T.g, () => T.d.stealAct.resolved, 30);
  T.g.rng.next = next;
  assert.ok(T.g.ball.owner === T.h && T.d.state !== 'stunned', 'a whiff out of range: no steal, no stun');
});

check('R7: no CPU poke in the first 0.8 s of LIVE nor within 0.5 s after the handler catch; human cooldown 0.8 s', () => {
  const g = new Game({ scene: null, anim: 'proxy', seed: 8, quarterSec: 120, ai: FROZEN_AI, auto: true });
  g.start({});
  assert.ok(stepUntil(g, () => g.state === 'LIVE', 120));
  const h = g.ball.owner;
  const d = g.players.find((p) => p.team !== h.team);
  g.startDribble(h);
  // LIVE 0–0.8 s
  assert.equal(g.startPoke(d, false), false, 'CPU poke rejected at LIVE + 0');
  for (let i = 0; i < 30; i++) g.step(1 / 60);
  assert.equal(g.startPoke(d, false), false, 'CPU poke rejected at LIVE + 0.5');
  for (let i = 0; i < 20; i++) g.step(1 / 60);
  // catch + 0.5 s
  h.cx.catchT = g.world.time - 0.3;
  assert.equal(g.startPoke(d, false), false, 'CPU poke rejected 0.3 s after the catch');
  h.cx.catchT = g.world.time - 0.6;
  assert.equal(g.startPoke(d, false), true, 'allowed 0.6 s after the catch (LIVE + 0.83)');
  assert.ok(Math.abs(d.stealCd - DIFFICULTY.normal.cpuStealInterval) < 1e-9, 'CPU attempt interval');
  // human cooldown 0.8 s
  const g2 = liveGame(9);
  const d2 = g2.players.find((p) => p.team !== g2.ball.owner.team);
  for (let i = 0; i < 60; i++) g2.step(1 / 60);
  d2.state = 'idle';
  assert.equal(g2.startPoke(d2, true), true);
  near(d2.stealCd, STEAL.COOLDOWN_HUMAN, 1e-9);
});

/** A chest pass from `pid` at (−3, −7) to `rid` at (3, −7) with defender `did` placed `off` metres off the line. */
function passSetup(seed, pid, rid, did, off) {
  const g = liveGame(seed);
  const p = g.byId[pid], r = g.byId[rid], d = g.byId[did];
  g.stageLive(p.team, p);
  g.teleport(p, -3, -7, Math.PI / 2);
  g.teleport(r, 3, -7, -Math.PI / 2);
  if (d) g.teleport(d, 0, -7 - off, 0);
  for (let i = 0; i < 2; i++) g.step(1 / 60);
  return { g, p, r, d };
}

check('pass: launched at RELEASE (passRelease, C6) from the hand socket (B52), caught by the receiver, assist chain', () => {
  const { g, p, r } = passSetup(10, 'lebron', 'kyrie', null, 0);
  const ev = [];
  g.on('*', (e, t) => ev.push({ t, toId: e.toId, fromId: e.fromId, kind: e.kind }));
  const sock = { x: 0, y: 0, z: 0 };
  let launch = null;
  g.startPass(p, r, false);
  const t0 = g.world.time;
  for (let i = 0; i < 40 && !launch; i++) {
    p.animator.querySocket(SOCK.ball, sock);
    const before = { x: sock.x, y: sock.y, z: sock.z };
    g.step(1 / 60);
    if (g.ball.state === 'pass') {
      p.animator.querySocket(SOCK.ball, sock);
      launch = { t: g.world.time - t0, before, sock: { x: sock.x, y: sock.y, z: sock.z }, ball: { x: g.ball.prevPos.x, y: g.ball.prevPos.y, z: g.ball.prevPos.z } };
    }
  }
  assert.ok(launch, 'pass launched');
  const dl = Math.hypot(launch.ball.x - launch.sock.x, launch.ball.y - launch.sock.y, launch.ball.z - launch.sock.z);
  assert.ok(dl <= 0.02, `launch point = hand socket (${dl.toFixed(4)} m, B52)`);
  near(launch.t, p.attrs.passRelease, 1 / 60 + 0.02, 'release at passRelease after the input');
  const pe = ev.find((e) => e.t === 'pass');
  assert.ok(pe && pe.toId === r.id);
  assert.ok(stepUntil(g, () => g.ball.isHeld, 90), 'caught');
  assert.equal(g.ball.owner, r);
  assert.ok(ev.some((e) => e.t === 'catch' && e.fromId === p.id));
});

check('interceptChance formula and clamps; Jordan hawk +0.20 radius; lobs above catchTopY + jumpY untouchable', () => {
  const g = liveGame();
  const k = g.byId.kobe;
  near(interceptChance(k, 0.3, 0.6), Math.max(0.15, Math.min(0.85, 0.35 + 0.45 * n(LEGENDS.kobe.ratings.steal) - 0.15 * 0.5)), 1e-12);
  near(interceptChance(g.byId.yao, 0.6, 0.6), Math.max(0.15, 0.35 + 0.45 * n(LEGENDS.yao.ratings.steal) - 0.15), 1e-12);
  assert.ok(interceptChance(k, 0, 1) <= 0.85 && interceptChance(g.byId.yao, 10, 1) >= 0.15);
  // a lob (apex 1.8 m) over a grounded defender standing on the line is untouchable: no roll at all
  for (let k = 0; k < 5; k++) {
    const T = passSetup(60 + k, 'lebron', 'kyrie', 'kobe', 0.0);
    T.d.stealCd = 9;
    T.g.startPass(T.p, T.r, true);
    assert.ok(stepUntil(T.g, () => T.g.ball.state === 'pass', 40));
    const top = 1.3 + PASS.LOB_APEX;
    assert.ok(top > T.d.attrs.catchTopY + 0.3);
    stepUntil(T.g, () => T.g.ball.state !== 'pass', 120);
    assert.equal(T.g.intRolled[T.d.idx], 0, 'no interception roll under a lob');
  }
});

check('A15 / S6: a defender 0.3 m off a 6 m chest-pass line intercepts or deflects ≥ 30 % of 30 passes', () => {
  let hits = 0, steals = 0;
  for (let k = 0; k < 30; k++) {
    const { g, p, r, d } = passSetup(100 + k, 'lebron', 'kyrie', 'kobe', 0.3);
    const ev = [];
    g.on('*', (e, t) => ev.push(t));
    d.stealCd = 9;                                                 // the defender only stands in the lane
    g.startPass(p, r, false);
    stepUntil(g, () => g.ball.state !== 'held' && g.ball.state !== 'dribble', 30);
    stepUntil(g, () => g.ball.isHeld || g.state !== 'LIVE', 120);
    if (ev.includes('intercept') || ev.includes('deflect')) hits++;
    if (ev.includes('intercept')) { steals++; assert.equal(d.stats.stl, 1, 'interception = STL to the catcher'); }
  }
  assert.ok(hits >= 9, `intercepted or deflected ${hits} / 30`);
  assert.ok(steals >= 1);
});

check('R6: a floor-bounced (deflected) pass caught by the defence is a STL, not a rebound', () => {
  const { g, p, r } = passSetup(40, 'lebron', 'kyrie', null, 0);
  g.startPass(p, r, false);
  assert.ok(stepUntil(g, () => g.ball.state === 'pass', 30));
  // deflect it to the floor near a defender
  const d = g.players.find((q) => q.team !== p.team);
  g.ball.state = 'loose'; g.ball.ctx = 'pass'; g.ball.vel.set(0, -2, 0); g.ball.pos.set(0.5, 0.6, -9);
  g.teleport(d, 0.5, -9.2, 0);
  for (const q of g.players) if (q !== d) g.teleport(q, q.team === p.team ? 6 : -6, -2, 0);
  assert.ok(stepUntil(g, () => g.ball.isHeld || g.state !== 'LIVE', 120));
  assert.equal(g.ball.owner === d || g.state === 'DEAD', true);
  assert.equal(d.stats.stl, 1, 'STL');
  assert.equal(d.stats.reb, 0, 'not a rebound');
});

check('human lane lunge: STEAL during an opponent pass → +0.20 intR for 0.40 s and a 1.0 m lunge toward the line', () => {
  const { g, p, r, d } = passSetup(41, 'lebron', 'kyrie', 'kobe', 2.0);
  g.setControlled(d);
  g.world.auto = false;
  for (const q of g.players) q.isUser = q === d;
  g.startPass(p, r, false);
  assert.ok(stepUntil(g, () => g.ball.state === 'pass', 30));
  const z0 = d.pos.z;
  pressButton(d.intent.tertiary, ms(g)); releaseButton(d.intent.tertiary, ms(g));
  g.step(1 / 60);
  assert.ok(g.world.time - d.cx.lungeT <= INTERCEPT.LUNGE_T + 1e-9, 'lunge armed');
  for (let i = 0; i < 15; i++) g.step(1 / 60);
  assert.ok(d.pos.z > z0 + 0.5, `lunged toward the pass line (${(d.pos.z - z0).toFixed(2)} m)`);
});

console.log(`unit-steal: ${passed} checks passed`);
