// Unit checks for ball.js, player.js and the game-level rules of game.js (headless, AnimProxy animators):
// ball states / events / looseT / catch rule with per-player attributes / socket attachment; player locomotion from the
// derived attributes (§5.2), stamina, turn rate, ballistic jumps from TAKEOFF (airtime exact) and the dunk profile,
// root motion, timers, facing; and the §5.13 rule fixtures R1 (points by the feet at the release input, S8), B11,
// R2 (an untouched air ball recovered by the offence keeps the shot clock), R3 (a release in the step the shot clock
// expires is valid), R4 (rattler: 0.4 s after the buzzer counts, 0.6 s does not), R5 (a blocked three that drops = 3),
// plus the state machine (CHECK → LIVE, periods, halftime, OT, game over / MVP, intro, lineup, pause, holdDead) and
// the event payloads.
// Run: node test/unit-ball.mjs
import assert from 'node:assert/strict';
import { Ball } from '../src/ball.js';
import { Player } from '../src/player.js';
import { Game, STATES, EVENTS } from '../src/game.js';
import { solveArc, apexForDistance } from '../src/physics.js';
import { RIM, BALL, FIXED_DT, CLOCK, MOVE, LINES, isThree } from '../src/constants.js';
import { Rng } from '../src/math.js';
import { SOCK } from '../src/anim/rig.js';
import { clipIndex } from '../src/anim/clip.js';
import { pressButton, releaseButton } from '../src/input.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (±${tol})`);
const FROZEN_AI = { updateAI() {} };
const dt = FIXED_DT;

function liveGame(seed = 1, extra = {}) {
  const g = new Game(Object.assign({ scene: null, anim: 'proxy', seed, quarterSec: 120, ai: FROZEN_AI, auto: true }, extra));
  g.start({});
  for (let i = 0; i < 80 && g.state !== 'LIVE'; i++) g.step(dt);
  assert.equal(g.state, 'LIVE');
  return g;
}
function stepUntil(g, pred, max = 240) {
  for (let i = 0; i < max; i++) { if (pred()) return true; g.step(dt); }
  return pred();
}
function shootFrom(g, id, x, z, opts) {
  const p = g.byId[id];
  g.stageLive(p.team, p);
  g.teleport(p, x, z, Math.PI);
  return g.debugShoot(Object.assign({ shooter: id }, opts));
}

// ================================================================================================ ball

function flight(from, target) {
  const ball = new Ball(new Rng(5));
  const shooter = { id: 'kobe', team: 0, hasBall: true, ballMode: 'held' };
  ball.owner = shooter;
  ball.pos.set(from.x, from.y, from.z);
  const d = Math.hypot(from.x - RIM.x, from.z - RIM.z);
  const arc = solveArc(from, target, apexForDistance(d), BALL.G, {});
  ball.launch(arc, 'flight', from);
  ball.ctx = 'shot'; ball.shot.active = true; ball.shot.shooter = shooter;
  return ball;
}

check('ball: a shot at the rim centre scores (swish), scored → loose after 0.5 s; launch clears the owner', () => {
  const ball = flight({ x: 0, y: 2.8, z: -8.3 }, RIM);
  assert.equal(ball.owner, null);
  let score = null, t = 0;
  for (let i = 0; i < 240 && !score; i++) { for (const e of ball.step(dt)) if (e.type === 'score') score = { value: e.value, t }; t += dt; }
  assert.ok(score, 'scored');
  assert.equal(score.value, 1, 'swish');
  assert.equal(ball.state, 'scored');
  for (let i = 0; i < 31; i++) ball.step(dt);
  assert.equal(ball.state, 'loose');
});

check('ball: a short miss hits the rim → loose, shot.touched (R2), looseT accumulates, y ≥ 0.10, rest after 1.5 s', () => {
  const ball = flight({ x: 0, y: 2.8, z: -8.3 }, { x: 0, y: RIM.y, z: RIM.z + RIM.r + 0.02 });
  const seen = {};
  let minY = Infinity;
  for (let i = 0; i < 60 * 8; i++) {
    for (const e of ball.step(dt)) seen[e.type] = (seen[e.type] || 0) + 1;
    minY = Math.min(minY, ball.pos.y);
  }
  assert.ok(seen.rim >= 1, 'rim contact');
  assert.equal(ball.shot.touched, true);
  assert.equal(ball.state, 'loose');
  assert.ok(ball.looseT > 5, 'looseT ' + ball.looseT);
  assert.ok(minY >= 0.10);
  assert.equal(seen.rest, 1, 'rest once');
  ball.launch({ x: 0, y: 1, z: 0 }, 'loose', { x: 0, y: 1, z: -5 });
  assert.equal(ball.looseT, 0, 'launch resets looseT');
});

check('ball: free-ball OOB emits once; NaN guard emits nan and resets to a safe point', () => {
  const ball = new Ball(new Rng(1));
  ball.launch({ x: 6, y: 0, z: 0 }, 'loose', { x: 7.5, y: 1, z: -6 });
  let oob = 0;
  for (let i = 0; i < 60; i++) for (const e of ball.step(dt)) if (e.type === 'oob') oob++;
  assert.equal(oob, 1);
  ball.launch({ x: NaN, y: 0, z: 0 }, 'loose', { x: 0, y: 1, z: -6 });
  const ev = ball.step(dt);
  assert.ok(ev.some((e) => e.type === 'nan'));
  assert.ok(Number.isFinite(ball.pos.x + ball.pos.y + ball.pos.z));
});

check('ball: catch rule with attrs (catchR, passReceiveR, catchTopY + jumpY, shot age 0.3 s, exclusions)', () => {
  const ball = new Ball(new Rng(1));
  const p = new Player({ id: 'yao', team: 0, index: 0, anim: 'proxy' });
  p.pos.set(0, 0, -6);
  const a = p.attrs;
  ball.launch({ x: 0, y: 0, z: 0 }, 'loose', { x: a.catchR - 0.01, y: 1.5, z: -6 });
  assert.equal(ball.canBeCaughtBy(p), true);
  ball.launch({ x: 0, y: 0, z: 0 }, 'loose', { x: a.catchR + 0.01, y: 1.5, z: -6 });
  assert.equal(ball.canBeCaughtBy(p), false, 'beyond catchR');
  ball.launch({ x: 0, y: 0, z: 0 }, 'pass', { x: a.catchR + 0.1, y: 1.5, z: -6 });
  ball.passInfo.receiver = p;
  assert.equal(ball.canBeCaughtBy(p), true, 'the receiver has passReceiveR');
  ball.launch({ x: 0, y: 0, z: 0 }, 'loose', { x: 0, y: a.catchTopY + 0.05, z: -6 });
  assert.equal(ball.canBeCaughtBy(p), false, 'above catchTopY');
  p.jumpY = 0.3;
  assert.equal(ball.canBeCaughtBy(p), true, '+ jumpY');
  p.jumpY = 0;
  ball.launch({ x: 0, y: 0, z: 0 }, 'flight', { x: 0, y: 1.5, z: -6 });
  assert.equal(ball.canBeCaughtBy(p), false, 'fresh shot');
  ball.releaseAge = 0.31;
  assert.equal(ball.canBeCaughtBy(p), true);
  ball.launch({ x: 0, y: 0, z: 0 }, 'loose', { x: 0, y: 1.5, z: -6 });
  ball.exclude1 = p;
  assert.equal(ball.canBeCaughtBy(p), false, 'excluded (blocker / poked handler) for 0.3 s');
  ball.releaseAge = 0.31;
  assert.equal(ball.canBeCaughtBy(p), true);
});

check('ball attachment by socket: held ball at the animator ball socket; proxy dribble height from the bounce phase', () => {
  const ball = new Ball(new Rng(1));
  const p = new Player({ id: 'kobe', team: 0, index: 0, anim: 'proxy' });
  p.reset(1, -6, Math.PI);
  ball.attachTo(p, 'held');
  p.animator.setBallMode('held');
  const s = { x: 0, y: 0, z: 0 };
  p.animator.querySocket(SOCK.ball, s);
  near(Math.hypot(ball.pos.x - s.x, ball.pos.y - s.y, ball.pos.z - s.z), 0, 1e-9, 'held = socket');
  assert.ok(p.hasBall && p.ballMode === 'held');
  ball.setHoldMode('dribble');
  p.animator.setBallMode('dribble');
  let lo = Infinity, hi = -Infinity, bounces = 0;
  const w = { players: [p], ball, offense: 0 };
  for (let i = 0; i < 120; i++) {
    p.step(dt, w);
    for (const e of ball.step(dt)) if (e.type === 'bounce') bounces++;
    lo = Math.min(lo, ball.pos.y); hi = Math.max(hi, ball.pos.y);
  }
  assert.ok(lo < BALL.R + 0.05 && hi > 0.6, `dribble range ${lo.toFixed(2)}..${hi.toFixed(2)}`);
  assert.ok(bounces >= 3, 'bounce events');
});

// ================================================================================================ player

function lonePlayer(id) {
  const p = new Player({ id, team: 0, index: 0, anim: 'proxy' });
  p.reset(0, -6, Math.PI);
  p.clampToCourt = false;
  return { p, w: { players: [p], ball: { pos: { x: 0, y: 0, z: 0 }, owner: null }, offense: 0 } };
}

check('locomotion (§5.2): accel to run, sprint × sprintMul, handler × handlerMul, decel, stamina drain / refill', () => {
  for (const id of ['kobe', 'yao', 'kyrie']) {
    const { p, w } = lonePlayer(id);
    const a = p.attrs;
    p.intent.move.x = 1; p.intent.move.z = 0; p.intent.move.mag = 1;
    const tAcc = a.run / a.accel;
    for (let i = 0; i < Math.ceil(tAcc / dt) + 2; i++) p.step(dt, w);
    near(p.speed, a.run, 1e-6, id + ' run');
    p.intent.sprint = true;
    for (let i = 0; i < 60; i++) p.step(dt, w);
    near(p.speed, a.run * a.sprintMul, 1e-6, id + ' sprint');
    near(p.stamina, 1 - a.staminaDrain * 1.0, 0.02, 'drain');
    p.hasBall = true;
    for (let i = 0; i < 30; i++) p.step(dt, w);
    near(p.speed, a.run * a.sprintMul * a.handlerMul, 1e-6, 'handler');
    p.hasBall = false; p.intent.sprint = false; p.intent.move.mag = 0; p.intent.move.x = 0;
    const s0 = p.speed;
    for (let i = 0; i < Math.ceil(s0 / a.decel / dt) + 2; i++) p.step(dt, w);
    near(p.speed, 0, 1e-9, 'stopped by decel');
    const st = p.stamina;
    for (let i = 0; i < 60; i++) p.step(dt, w);
    near(p.stamina, Math.min(1, st + MOVE.STAMINA_REFILL), 1e-6, 'refill 1/6 per s');
  }
});

check('turn rate attrs.turn (C21) and the handler facing rule (slow handler faces the rim)', () => {
  const { p, w } = lonePlayer('yao');
  p.yaw = 0;                                         // facing +z (away from the rim)
  p.hasBall = true; p.offense = true;
  const y0 = p.yaw;
  for (let i = 0; i < 6; i++) p.step(dt, w);
  near(Math.abs(p.yaw - y0), p.attrs.turn * 6 * dt, 1e-6, 'turning at attrs.turn');
  for (let i = 0; i < 60; i++) p.step(dt, w);
  near(Math.abs(Math.abs(p.yaw) - Math.PI), 0, 1e-3, 'faces the rim');
});

check('ballistic jump from TAKEOFF: apex h, airtime T exact, landing flag; dunk rise–hang–drop profile', () => {
  const { p, w } = lonePlayer('jordan');
  const h = 0.82, T = 2 * Math.sqrt(2 * h / 9.81);
  p.startJump(h, T, null, 'block', 0);
  let top = 0, steps = 0, landed = false;
  while (!landed && steps < 200) { p.step(dt, w); top = Math.max(top, p.jumpY); landed = p.landedNow; steps++; }
  assert.ok(landed);
  near(top, h, 0.01, 'apex');
  near(steps * dt, T, dt + 1e-9, 'airtime');
  // dunk: profile {slam, hang}: apex at slam + 0.03, hang eases h → h − 0.05, free fall
  const prof = { slam: 0.40, hang: 0.15 };
  const air = p.startJump(0.74, 1.0, prof, 'dunk', 0);
  const tUp = prof.slam + 0.03, g = 2 * 0.74 / (tUp * tUp);
  near(air, tUp + prof.hang + Math.sqrt(2 * 0.69 / g), 1e-9, 'profile airtime');
  let hung = false; steps = 0; landed = false;
  while (!landed && steps < 200) { p.step(dt, w); hung = hung || p.hanging; landed = p.landedNow; steps++; }
  assert.ok(hung, 'hang phase flagged (separation 0.95 m)');
  near(steps * dt, air, dt + 1e-9);
});

check('root motion: a crossover clip drives the velocity and position (no teleport); stun and fall timers', () => {
  const { p, w } = lonePlayer('kyrie');
  p.hasBall = true; p.ballMode = 'dribble';
  const x0 = p.pos.x;
  p.playClip(clipIndex('move.cross'), null);
  let moved = 0, maxStep = 0;
  for (let i = 0; i < 24; i++) { const px = p.pos.x, pz = p.pos.z; p.step(dt, w); maxStep = Math.max(maxStep, Math.hypot(p.pos.x - px, p.pos.z - pz)); }
  moved = Math.abs(p.pos.x - x0);
  assert.ok(moved > 0.3, 'lateral displacement ' + moved.toFixed(2));
  assert.ok(maxStep < 0.2, 'no teleport');
  p.stun(0.30);
  assert.equal(p.state, 'stunned');
  for (let i = 0; i < 19; i++) p.step(dt, w);
  assert.equal(p.state, 'idle');
  p.fall(1.60);
  for (let i = 0; i < 95; i++) p.step(dt, w);
  assert.equal(p.state, 'fallen');
  for (let i = 0; i < 2; i++) p.step(dt, w);
  assert.equal(p.state, 'idle');
});

// ================================================================================================ rules

check('B11 / R1: debugShoot p 1 from (0, −8.3) → +2; from (0, −4.8) → +3 (feet at release)', () => {
  let g = liveGame(2);
  let p = g.byId.lebron;
  shootFrom(g, 'lebron', 0, -8.3, { p: 1, eT: 0 });
  assert.ok(stepUntil(g, () => g.score[p.team] > 0, 240), 'scored within 4 s');
  assert.equal(g.score[p.team], 2);
  assert.ok(stepUntil(g, () => g.state === 'LIVE' && g.world.offense !== p.team, 300), 'DEAD → CHECK → LIVE, possession switched');
  g = liveGame(3);
  p = g.byId.lebron;
  shootFrom(g, 'lebron', 0, -4.8, { p: 1, eT: 0 });
  assert.ok(stepUntil(g, () => g.score[p.team] > 0, 240));
  assert.equal(g.score[p.team], 3);
  assert.equal(p.stats.tpm, 1);
});

check('S8 / R1: a sprinting shooter pressing 0.1 m outside the arc and releasing 0.4 m inside scores 2; stationary 3', () => {
  for (let k = 0; k < 10; k++) {
    const g = liveGame(20 + k);
    const p = g.byId.kobe;
    g.stageLive(p.team, p);
    const z0 = RIM.z + LINES.THREE_R + 0.1;
    g.teleport(p, 0, z0, Math.PI);
    p.vel.set(0, 0, -6.0);
    pressButton(p.intent.primary, g.world.time * 1000);
    g.step(dt);
    assert.ok(p.shot.active, 'shot started');
    let released = false;
    for (let i = 0; i < 60 && !released; i++) {
      const inside = (RIM.z + LINES.THREE_R) - p.pos.z;
      if (inside >= 0.4 && g.world.time - p.shot.pressT >= 0.13) releaseButton(p.intent.primary, g.world.time * 1000);
      g.step(dt);
      released = p.shot.released;
    }
    assert.ok(released, 'released');
    assert.ok(!isThree(p.shot.x, p.shot.z), 'feet inside the arc at release');
    assert.equal(p.shot.points, 2, 'pressed outside, released inside → 2');
  }
  const g = liveGame(40);
  const p = g.byId.kobe;
  shootFrom(g, 'kobe', 0, RIM.z + LINES.THREE_R + 0.1, { p: 1, eT: 0 });
  assert.ok(stepUntil(g, () => p.shot.released, 120));
  assert.equal(p.shot.points, 3, 'stationary 0.1 m outside → 3');
});

check('R2: an untouched air ball recovered by the offence keeps the shot clock running; a rim miss resets it', () => {
  const g = liveGame(5);
  const p = g.byId.lebron;
  shootFrom(g, 'lebron', 0, -8.3, { p: 0, eT: -0.20 });
  assert.ok(stepUntil(g, () => g.ball.state === 'flight', 120));
  assert.equal(p.shot.airball, true);
  const mate = g.roster[p.team][1];
  g.teleport(mate, 0, -12.1, Math.PI);
  assert.ok(stepUntil(g, () => g.ball.owner === mate || g.state !== 'LIVE', 240), 'offence recovers');
  assert.equal(g.ball.shot.touched, false);
  assert.ok(g.world.shotClock < CLOCK.SHOT - 1.0, 'shot clock kept running: ' + g.world.shotClock.toFixed(2));
  // a miss that touched the rim, recovered by the offence → 14
  const g2 = liveGame(6);
  const q = g2.byId.lebron;
  shootFrom(g2, 'lebron', 0, -8.3, { p: 0, eT: -0.10 });
  assert.ok(stepUntil(g2, () => g2.ball.shot.touched || g2.state !== 'LIVE', 240), 'touched the rim');
  const mate2 = g2.roster[q.team][1];
  assert.ok(stepUntil(g2, () => { if (g2.ball.isFree && g2.ball.state === 'loose') g2.teleport(mate2, g2.ball.pos.x, g2.ball.pos.z, 0); return g2.ball.owner === mate2 || g2.state !== 'LIVE'; }, 240));
  if (g2.ball.owner === mate2) near(g2.world.shotClock, CLOCK.SHOT, 2 * dt, 'reset to 14');
});

check('R3: a release in the step the shot clock expires is valid; with the clock already 0 it is whistled', () => {
  const g = liveGame(7);
  const p = g.byId.lebron;
  const ev = [];
  g.on('*', (e, t) => ev.push({ t, reason: e.reason }));
  shootFrom(g, 'lebron', 0, -8.3, { p: 1, eT: 0 });
  const s = p.shot;
  // just before the release step: let the clock expire during that very step
  assert.ok(stepUntil(g, () => g.world.time + dt - s.pressT + 1e-9 >= s.tIdeal + s.forcedET, 120));
  g.world.shotClock = dt * 0.5;
  g.step(dt);
  assert.ok(s.released, 'released in the expiry step');
  assert.ok(stepUntil(g, () => g.score[p.team] > 0 || g.state !== 'LIVE', 240));
  assert.equal(g.score[p.team], 2, 'the basket counts');
  assert.ok(!ev.some((e) => e.t === 'turnover' && e.reason === 'shotClock'), 'no violation');
  // clock already at 0 at the start of the step: violation before the release is processed
  const g2 = liveGame(8);
  const q = g2.byId.lebron;
  const ev2 = [];
  g2.on('*', (e, t) => ev2.push({ t, reason: e.reason }));
  shootFrom(g2, 'lebron', 0, -8.3, { p: 1, eT: 0 });
  assert.ok(stepUntil(g2, () => g2.world.time + dt - q.shot.pressT + 1e-9 >= q.shot.tIdeal, 120));
  g2.world.shotClock = 0;
  g2.step(dt);
  assert.ok(ev2.some((e) => e.t === 'turnover' && e.reason === 'shotClock'), 'whistled');
  assert.equal(g2.state, 'DEAD');
});

/** A real shot whose ball is then hovered over the hoop so it drops through `delay` s after becoming loose. */
function rattler(seed, delay) {
  const g = liveGame(seed);
  const p = g.byId.lebron;
  shootFrom(g, 'lebron', 0, -8.3, { p: 1, eT: 0 });
  assert.ok(stepUntil(g, () => g.ball.state === 'flight', 120));
  const b = g.ball;
  // the rim kicked it straight up: loose, touched; it falls through the cylinder after `delay` s
  b.state = 'loose'; b.shot.touched = true; b.looseT = 0; b.rimContacts = 1; b.contacted = true;
  const fall = 0.5 * 9.81 * delay * delay;
  b.pos.set(RIM.x, RIM.y + fall + 0.01, RIM.z); b.vel.set(0, 0, 0); b.prevPos.copy(b.pos);
  g.world.gameClock = dt * 0.5;                       // the buzzer sounds in this step
  const team = p.team, before = g.score[team];
  for (let i = 0; i < 120; i++) g.step(dt);
  return g.score[team] - before;
}

check('R4: a rim-rattler dropping 0.4 s after the buzzer counts, 0.6 s does not (period ends at 0.5 s loose)', () => {
  assert.equal(rattler(30, 0.40), 2, '0.4 s counts');
  assert.equal(rattler(31, 0.60), 0, '0.6 s does not');
});

check('R5: a blocked three that still drops keeps 3 points for the shooter', () => {
  const g = liveGame(9);
  const p = g.byId.lebron;
  shootFrom(g, 'lebron', 0, -4.8, { p: 0, eT: 0 });
  assert.ok(stepUntil(g, () => g.ball.state === 'flight', 120));
  assert.equal(p.shot.points, 3);
  const d = g.roster[1 - p.team][0];
  // the block: lastToucher = the defender, touched; the ball then drops through the hoop
  g.applyBlock(d, p, false, false);
  const b = g.ball;
  b.state = 'loose';
  b.pos.set(RIM.x, RIM.y + 0.6, RIM.z); b.vel.set(0, 0, 0); b.prevPos.copy(b.pos);
  assert.ok(stepUntil(g, () => g.score[p.team] > 0, 120));
  assert.equal(g.score[p.team], 3, 'deflected make keeps shotInfo.points');
  assert.equal(p.stats.pts, 3);
  assert.equal(d.stats.blk, 1);
});

check('state machine: CHECK → LIVE at 1.2 s, periods, halftime 3 s, OT on a tie, GAME_OVER with MVP; Q1/Q2/Q3/Q4 order', () => {
  const g = new Game({ scene: null, anim: 'proxy', seed: 11, quarterSec: 6, ai: FROZEN_AI, auto: true });
  const states = [];
  const ev = { quarter: 0, gameover: null };
  g.on('state', (e) => states.push(e.to));
  g.on('quarter', () => ev.quarter++);
  g.on('gameover', (e) => { ev.gameover = { winner: e.winner, mvpId: e.mvpId, rows: e.box.length }; });
  g.start({});
  assert.equal(g.state, 'CHECK');
  for (let i = 0; i < Math.round(CLOCK.CHECK / dt) - 1; i++) g.step(dt);
  assert.equal(g.state, 'CHECK');
  g.step(dt); g.step(dt);
  assert.equal(g.state, 'LIVE');
  const opening = [];
  g.on('state', (e) => { if (e.to === 'CHECK' && (e.reason === 'quarter')) opening.push(g.world.offense); });
  g.score[0] = 2;                                     // avoid overtime
  for (let i = 0; i < 60 * 60 && g.state !== 'GAME_OVER'; i++) g.step(dt);
  assert.equal(g.state, 'GAME_OVER');
  assert.ok(states.includes('HALFTIME') && states.includes('QUARTER_END'));
  assert.equal(ev.quarter, 4);
  assert.ok(ev.gameover && ev.gameover.rows === 6 && ev.gameover.winner === 0 && !!ev.gameover.mvpId);
  assert.equal(g.byId[ev.gameover.mvpId].team, 0, 'MVP from the winning team');
  assert.deepEqual(opening, [1 - g.q1Offense, 1 - g.q1Offense, g.q1Offense], 'Q2 other, Q3 = Q2, Q4 = Q1');
  // tie → overtime 1:00
  const t = new Game({ scene: null, anim: 'proxy', seed: 12, quarterSec: 3, ai: FROZEN_AI, auto: true });
  t.start({});
  for (let i = 0; i < 60 * 60 && t.world.quarter < 5; i++) t.step(dt);
  assert.equal(t.world.quarter, 5, 'overtime');
  near(t.world.gameClock, CLOCK.OT, 0.01);
});

check('lifecycle: intro / endIntro, lineup, pause + resume countdown, holdDead, quit, rematch, setLineup', () => {
  const g = new Game({ scene: null, anim: 'proxy', seed: 13, quarterSec: 60, ai: FROZEN_AI, auto: true });
  assert.equal(g.state, 'MENU');
  g.enterLineup();
  assert.equal(g.state, 'LINEUP');
  g.step(dt);
  assert.equal(g.state, 'LINEUP', 'no sim in LINEUP');
  g.start({ intro: true });
  assert.equal(g.state, 'INTRO');
  g.step(dt);
  assert.equal(g.state, 'INTRO');
  g.endIntro();
  assert.equal(g.state, 'CHECK');
  stepUntil(g, () => g.state === 'LIVE', 100);
  const clock = g.world.gameClock;
  assert.equal(g.pause(), true);
  for (let i = 0; i < 30; i++) g.step(dt);
  assert.equal(g.world.gameClock, clock, 'clock frozen while paused');
  g.resume();
  for (let i = 0; i < 59; i++) g.step(dt);
  assert.equal(g.paused, true, 'countdown 1.0 s');
  g.step(dt); g.step(dt);
  assert.equal(g.paused, false);
  g.turnover();
  assert.equal(g.state, 'DEAD');
  near(g.holdDead(3.0), 3.0, 1e-9);
  for (let i = 0; i < 150; i++) g.step(dt);
  assert.equal(g.state, 'DEAD', 'held for the replay');
  stepUntil(g, () => g.state === 'CHECK', 100);
  g.quit();
  assert.equal(g.state, 'MENU');
  g.rematch();
  assert.equal(g.state, 'CHECK');
  assert.deepEqual(g.score, [0, 0]);
  assert.equal(g.setLineup({ a: ['kobe', 'kyrie', 'yao'], b: ['jordan', 'lebron', 'giannis'], user: 'b', kits: 'auto' }), true);
  assert.equal(g.byId.kobe.team, 0); assert.equal(g.byId.lebron.team, 1);
  assert.equal(g.world.user, 1);
  assert.equal(g.state, 'CHECK', 'in a game: restarted');
  assert.equal(g.setLineup({ a: ['kobe', 'kobe', 'yao'], b: ['jordan', 'lebron', 'giannis'] }), false);
});

check('events: §1.4.1 names only, pooled payloads with base fields; meter source during a human windup', () => {
  const g = new Game({ scene: null, anim: 'proxy', seed: 14, quarterSec: 120, auto: false, ai: FROZEN_AI });
  const names = new Set();
  g.on('*', (e, t) => { names.add(t); assert.equal(e.type, t); assert.ok(Number.isFinite(e.t + e.x + e.z)); });
  g.start({});
  stepUntil(g, () => g.state === 'LIVE', 100);
  const user = g.world.controlled;
  if (user.team !== g.world.offense) g.turnover();
  stepUntil(g, () => g.state === 'LIVE' && g.world.controlled.team === g.world.offense, 300);
  const c = g.world.controlled;
  g.stageLive(c.team, c);
  g.teleport(c, 0, -8.3, Math.PI);
  pressButton(c.intent.primary, g.world.time * 1000);
  g.step(dt); g.step(dt);
  for (let i = 0; i < 10; i++) g.step(dt);
  assert.equal(g.meter.active, true, 'meter active for the human windup');
  assert.ok(g.meter.fill > 0 && g.meter.fill < 1.25);
  assert.ok(g.meter.greenLo < 0.80 && g.meter.greenHi > 0.80);
  assert.equal(g.meter.points, 2);
  releaseButton(c.intent.primary, g.world.time * 1000);
  g.step(dt);
  assert.ok(['perfect', 'early', 'late'].includes(g.meter.flash), 'flash ' + g.meter.flash);
  for (let i = 0; i < 400; i++) g.step(dt);
  for (const n of names) assert.ok(EVENTS.includes(n), 'known event ' + n);
  assert.ok(names.has('shot') && names.has('release') && names.has('state') && names.has('possession'));
  assert.ok(g.recentEvents().length <= 64);
  assert.ok(STATES.includes(g.state));
});

check('auto-switch (R10): an opponent catch moves control to his defender after ≥ 0.40 s of idle stick; off → never', () => {
  for (const on of [true, false]) {
    const g = new Game({ scene: null, anim: 'proxy', seed: 15, quarterSec: 120, auto: false, ai: FROZEN_AI, rules: { clear: false, autoSwitch: on } });
    g.start({});
    stepUntil(g, () => g.state === 'LIVE', 100);
    if (g.world.offense === g.world.user) { g.turnover(); stepUntil(g, () => g.state === 'LIVE', 300); }
    assert.notEqual(g.world.offense, g.world.user);
    const handler = g.ball.owner;
    const receiver = g.roster[g.world.offense].find((q) => q !== handler);
    const mine = g.roster[g.world.user].find((q) => q.defAssign === receiver);
    const u = g.world.controlled;
    assert.notEqual(u, mine, 'controlling someone else');
    u.intent.move.idle = 0.5;
    g.startPass(handler, receiver, false);
    assert.ok(stepUntil(g, () => g.ball.owner === receiver || g.state !== 'LIVE', 120));
    if (g.ball.owner === receiver) assert.equal(g.world.controlled === mine, on, on ? 'switched' : 'not switched');
  }
});

check('tip / putback (§5.6): an airborne offensive player at a descending miss tips it (kind tip, FGA); Giannis slams it', () => {
  for (const tipper of ['kyrie', 'giannis']) {
    const g = liveGame(3);
    shootFrom(g, 'lebron', 0, -8.3, { eT: 0, p: 0 });
    const kinds = [];
    g.on('release', (e) => kinds.push('release:' + e.kind + '@' + e.playerId));
    g.on('slam', (e) => kinds.push('slam@' + e.playerId));
    const t = g.byId[tipper];
    let placed = false;
    for (let k = 0; k < 400 && !placed; k++) {
      g.step(dt);
      const b = g.ball;
      if (b.state === 'loose' && b.ctx === 'shot' && b.vel.y < 0 && b.rimDistance() < 1.0 && b.pos.y < 3.4) {
        g.teleport(t, b.pos.x, b.pos.z + 0.3, Math.PI);
        const h = Math.max(0.3, b.pos.y - t.legend.stats.reachM + 0.35);
        t.state = 'jump'; t.startJump(h, 2 * Math.sqrt(2 * h / 9.81), null, 'rebound', 0);
        t.jumpT = t.jumpAir / 2 - dt; t.jumpY = t.jumpAt(t.jumpT);
        placed = true;
      }
    }
    assert.ok(placed, 'miss reached the rim area');
    for (let k = 0; k < 120; k++) g.step(dt);
    if (tipper === 'kyrie') {
      assert.ok(kinds.includes('release:tip@kyrie'), kinds.join(' '));
      assert.equal(t.stats.fga, 1, 'the tip is a field-goal attempt');
    } else {
      assert.ok(kinds.includes('slam@giannis'), kinds.join(' '));
      assert.equal(t.stats.pts, 2, 'putback dunk scores 2');
    }
  }
});

check('kobe.jab rip-through: after 2 jabs, SPRINT + stick toward the rim within 0.8 s starts sig.kobe.jabGo; 1 jab does not', () => {
  for (const jabs of [2, 1]) {
    const g = liveGame(4);
    const k = g.byId.kobe;
    g.stageLive(k.team, k); g.teleport(k, 1, -7.5, Math.PI);
    assert.ok(k.holding);
    const moves = [];
    g.on('move', (e) => moves.push(e.moveId));
    k.cx.jabsThisHold = jabs; k.cx.lastJabT = g.world.time;
    const dx = RIM.x - k.pos.x, dz = RIM.z - k.pos.z, L = Math.hypot(dx, dz);
    k.intent.move.x = dx / L; k.intent.move.z = dz / L; k.intent.move.mag = 1; k.intent.move.idle = 0; k.intent.sprint = true;
    for (let i = 0; i < 30; i++) g.step(dt);
    assert.equal(moves.includes('sig.kobe.jabGo'), jabs === 2, moves.join(','));
    if (jabs === 2) assert.ok(k.dribbling && k.speed > 4.0, 'driving ' + k.speed);
  }
});

console.log(`unit-ball: ${passed} checks passed`);
