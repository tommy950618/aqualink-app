// Unit checks for ball.js, player.js and camera.js (no DOM, no renderer).
// Run: node test/unit-ball.mjs
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { Ball } from '../src/ball.js';
import { Player, makeIntent, clearEdges } from '../src/player.js';
import { BroadcastCamera } from '../src/camera.js';
import { solveArc, apexForDistance } from '../src/physics.js';
import { RIM, BALL, FIXED_DT, MOVE, JUMP, SHOT } from '../src/constants.js';
import { Rng } from '../src/math.js';
import { TEAMS } from '../src/teams.js';
import { createHumanoid } from '../src/humanoid.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

const EMPTY_WORLD = { players: [], offense: 0, rng: new Rng(1) };

function flyFrom(from, target, apex, maxSeconds) {
  const ball = new Ball(null, new Rng(5));
  ball.pos.set(from.x, from.y, from.z);
  const arc = solveArc(from, target, apex, BALL.G, {});
  const shooter = { name: 'S', hasBall: true, ballMode: 'held', state: 'release' };
  ball.owner = shooter; shooter.hasBall = true;
  ball.launch(arc, 'flight', { shooter, points: 2, kind: 'jumper' });
  const seen = { rim: 0, board: 0, bounce: 0, score: 0, rest: 0, nan: 0, oob: 0 };
  let minY = Infinity, firstScoreT = -1;
  const scoreEvent = { value: 0, playerName: null };   // copied: event objects are pooled and reused
  const events = [];
  const steps = Math.round(maxSeconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    ball.step(FIXED_DT, EMPTY_WORLD, events);
    for (const e of events) {
      seen[e.type] = (seen[e.type] || 0) + 1;
      if (e.type === 'score' && firstScoreT < 0) {
        firstScoreT = (i + 1) * FIXED_DT;
        scoreEvent.value = e.value;
        scoreEvent.playerName = e.player ? e.player.name : null;
      }
    }
    const p = ball.pos;
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), 'finite position');
    minY = Math.min(minY, p.y);
  }
  return { ball, seen, minY, firstScoreT, scoreEvent, arc };
}

check('a shot solved to the rim centre scores within 3 s (score event, points from shotInfo)', () => {
  const from = { x: 0, y: 2.05, z: -8 };
  const r = flyFrom(from, { x: RIM.x, y: RIM.y, z: RIM.z }, apexForDistance(4.75), 3);
  assert.equal(r.seen.score, 1, 'exactly one score event: ' + JSON.stringify(r.seen));
  assert.ok(r.firstScoreT > 0 && r.firstScoreT <= 3, 'score time ' + r.firstScoreT);
  assert.equal(r.scoreEvent.value, 2);
  assert.equal(r.scoreEvent.playerName, 'S');
  assert.ok(r.minY >= 0.10, 'min y ' + r.minY);
  assert.ok(r.ball.state === 'loose' || r.ball.state === 'scored', 'post-score state ' + r.ball.state);
  assert.equal(r.seen.nan, 0);
});

check('a shot 0.3 m short hits the rim, then bounces on the floor; y >= 0.10 and no NaN', () => {
  const from = { x: 0, y: 2.05, z: -8 };
  const target = { x: RIM.x, y: RIM.y, z: RIM.z + 0.3 };   // 0.3 m toward the shooter = short
  const r = flyFrom(from, target, apexForDistance(4.75), 4);
  assert.ok(r.seen.rim >= 1, 'rim events ' + JSON.stringify(r.seen));
  assert.ok(r.seen.bounce >= 1, 'bounce events ' + JSON.stringify(r.seen));
  assert.equal(r.seen.score, 0, 'a short miss must not score');
  assert.ok(r.minY >= 0.10, 'min y ' + r.minY);
  assert.equal(r.ball.state, 'loose');
  assert.ok(r.ball.pos.y < 0.5, 'ball has come down to the floor: y ' + r.ball.pos.y);
});

check('resting free ball emits rest once after 1.5 s; NaN guard emits nan and resets', () => {
  const ball = new Ball(null, new Rng(2));
  ball.pos.set(1, BALL.R, -6); ball.vel.set(0, 0, 0); ball.state = 'loose';
  const events = [];
  let rests = 0;
  for (let i = 0; i < 180; i++) { ball.step(FIXED_DT, EMPTY_WORLD, events); for (const e of events) if (e.type === 'rest') rests++; }
  assert.equal(rests, 1);
  ball.vel.x = NaN;
  ball.step(FIXED_DT, EMPTY_WORLD, events);
  assert.ok(events.some((e) => e.type === 'nan'));
  assert.ok(Number.isFinite(ball.pos.x) && Number.isFinite(ball.vel.x));
});

check('free-ball OOB emits once; a held ball follows the owner and dribbles after 0.35 s', () => {
  const ball = new Ball(null, new Rng(3));
  ball.pos.set(8.5, BALL.R, -6); ball.state = 'loose';
  const events = [];
  let oob = 0;
  for (let i = 0; i < 10; i++) { ball.step(FIXED_DT, EMPTY_WORLD, events); for (const e of events) if (e.type === 'oob') oob++; }
  assert.equal(oob, 1);

  const p = new Player({ team: TEAMS[0], teamIdx: 0, index: 0, data: TEAMS[0].players[0], humanoid: null });
  p.reset(0, -4.6, Math.PI);
  ball.attachTo(p, 'held');
  assert.equal(ball.state, 'held');
  assert.equal(p.hasBall, true);
  assert.ok(Math.abs(ball.pos.y - BALL.CHEST_Y) < 1e-9);
  const world = { players: [p], offense: 0, rng: new Rng(4) };
  let bounces = 0;
  p.intent.move.x = 0; p.intent.move.z = -1; p.intent.move.mag = 1;
  for (let i = 0; i < 120; i++) {
    p.step(FIXED_DT, world);
    ball.step(FIXED_DT, world, events);
    for (const e of events) if (e.type === 'bounce') bounces++;
  }
  assert.equal(ball.state, 'dribble');
  assert.ok(bounces >= 3, 'dribble bounces ' + bounces);
  assert.ok(ball.pos.y >= BALL.R && ball.pos.y <= BALL.R + 0.80 + 1e-9);
  assert.ok(Math.hypot(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z) < 0.5);
  // launch detaches the owner
  ball.launch({ x: 0, y: 3, z: -6 }, 'pass', { receiver: null, from: p });
  assert.equal(p.hasBall, false);
  assert.equal(ball.state, 'pass');
  assert.equal(ball.lastToucher, p);
});

check('catch rule: radius, height window, receiver bonus, own-shot age', () => {
  const ball = new Ball(null, new Rng(6));
  const mk = (x, z) => ({ pos: { x, y: 0, z }, hasBall: false, state: 'idle', jumpY: 0, data: { height: 1 } });
  const a = mk(0, -6), b = mk(0.7, -6);
  ball.pos.set(0, 1.2, -6); ball.vel.set(1, 0, 0); ball.state = 'loose';
  assert.equal(ball.canBeCaughtBy(a), true);
  assert.equal(ball.canBeCaughtBy(b), false, '0.7 m > 0.55');
  ball.state = 'pass'; ball.passInfo.receiver = b;
  assert.equal(ball.canBeCaughtBy(b), true, 'receiver radius 0.80');
  ball.pos.y = 2.5;
  assert.equal(ball.canBeCaughtBy(a), false, 'too high');
  a.jumpY = 0.5;
  assert.equal(ball.canBeCaughtBy(a), true, 'reachable when jumping');
  ball.state = 'flight'; ball.releaseAge = 0.1; ball.shotInfo.shooter = a; ball.pos.y = 1.2;
  assert.equal(ball.canBeCaughtBy(a), false, 'flight younger than 0.3 s');
  ball.releaseAge = 0.4;
  assert.equal(ball.canBeCaughtBy(a), true);
  ball.vel.set(15, 0, 0);
  assert.equal(ball.canBeCaughtBy(a), false, 'too fast');
});

check('player movement: accel to run speed, sprint x1.35 drains stamina, stop decel, handler x0.92', () => {
  const p = new Player({ team: TEAMS[0], teamIdx: 0, index: 1, data: { speed: 1, height: 1 }, humanoid: null });
  p.reset(0, -6, Math.PI);
  const world = { players: [p], offense: 1, rng: new Rng(1) };
  p.intent.move.x = 1; p.intent.move.z = 0; p.intent.move.mag = 1;
  for (let i = 0; i < 60; i++) p.step(FIXED_DT, world);
  assert.ok(Math.abs(p.speed - MOVE.RUN) < 1e-6, 'run speed ' + p.speed);
  assert.equal(p.state, 'move');
  assert.ok(Math.abs(p.yaw - Math.PI / 2) < 1e-6, 'faces +x, yaw ' + p.yaw);
  p.intent.sprint = true;
  for (let i = 0; i < 60; i++) p.step(FIXED_DT, world);
  assert.ok(Math.abs(p.speed - MOVE.RUN * MOVE.SPRINT_MUL) < 1e-6, 'sprint speed ' + p.speed);
  assert.ok(p.stamina < 1 - 0.9 / 4 && p.stamina > 1 - 1.1 / 4, 'stamina ' + p.stamina);
  assert.equal(p.sprintedRecently, true);
  // Hold sprint until the bar empties: sprint locks, speed drops to run speed...
  let steps = 0;
  while (p.stamina > 0 && steps++ < 600) p.step(FIXED_DT, world);
  assert.equal(p.stamina, 0);
  assert.equal(p.sprintLocked, true);
  for (let i = 0; i < 60; i++) p.step(FIXED_DT, world);
  assert.ok(Math.abs(p.speed - MOVE.RUN) < 1e-6, 'sprint disabled at 0 stamina: ' + p.speed);
  assert.ok(p.stamina > 0.15 && p.stamina < 0.18, 'refills at 1/6 per s: ' + p.stamina);
  // ... and re-enables once the bar refills to 0.25.
  steps = 0;
  while (p.sprintLocked && steps++ < 600) p.step(FIXED_DT, world);
  assert.ok(p.stamina >= MOVE.STAMINA_RELOCK && p.stamina < 0.26, 'unlocked at 0.25: ' + p.stamina);
  for (let i = 0; i < 30; i++) p.step(FIXED_DT, world);
  assert.ok(Math.abs(p.speed - MOVE.RUN * MOVE.SPRINT_MUL) < 1e-6, 'sprinting again ' + p.speed);
  p.intent.sprint = false;
  p.intent.move.mag = 0; p.intent.move.x = 0;
  const sBefore = p.speed;
  p.step(FIXED_DT, world);
  assert.ok(Math.abs(p.speed - (sBefore - MOVE.DECEL * FIXED_DT)) < 1e-6, 'decel 16: ' + sBefore + ' -> ' + p.speed);
  for (let i = 0; i < 60; i++) p.step(FIXED_DT, world);
  assert.equal(p.speed, 0);
  assert.equal(p.state, 'idle');
  assert.equal(p.sprintedRecently, false);
  // handler multiplier
  p.hasBall = true; p.ballMode = 'dribble';
  p.intent.move.x = 0; p.intent.move.z = -1; p.intent.move.mag = 1;
  for (let i = 0; i < 60; i++) p.step(FIXED_DT, world);
  assert.ok(Math.abs(p.speed - MOVE.RUN * MOVE.HANDLER_MUL) < 1e-6, 'handler speed ' + p.speed);
  // walking at mag 0.4
  p.intent.move.mag = 0.4;
  for (let i = 0; i < 60; i++) p.step(FIXED_DT, world);
  assert.ok(Math.abs(p.speed - MOVE.RUN * 0.4 * MOVE.HANDLER_MUL) < 1e-6, 'walk speed ' + p.speed);
});

check('jump arc, windup/release states, block jump on primary tap, no air control', () => {
  const p = new Player({ team: TEAMS[1], teamIdx: 1, index: 0, data: TEAMS[1].players[0], humanoid: null });
  p.reset(0, -8.3, Math.PI);
  const world = { players: [p], offense: 1, rng: new Rng(1) };
  assert.equal(p.startWindup('jumper'), true);
  assert.equal(p.state, 'windup');
  assert.equal(p.isJumping, true);
  let peak = 0;
  for (let i = 0; i < 16; i++) { p.step(FIXED_DT, world); peak = Math.max(peak, p.jumpY); }
  assert.ok(Math.abs(peak - JUMP.H_SHOT) < 0.01, 'peak ' + peak);
  assert.ok(p.meterF > 0.4 && p.meterF < 0.55, 'meterF ' + p.meterF);
  p.release();
  assert.equal(p.state, 'release');
  for (let i = 0; i < 20; i++) p.step(FIXED_DT, world);
  assert.equal(p.isJumping, false);
  assert.equal(p.jumpY, 0);
  assert.equal(p.state, 'idle');
  assert.ok(p.releaseAge > 0.3);
  // Block jump: primary tap on a player without the ball, momentum preserved in the air.
  p.intent.move.x = 1; p.intent.move.mag = 1;
  for (let i = 0; i < 30; i++) p.step(FIXED_DT, world);
  const v0 = p.speed;
  p.intent.primary.justPressed = true;
  p.step(FIXED_DT, world);
  clearEdges(p.intent);
  assert.equal(p.isJumping, true);
  assert.equal(p.state, 'jump');
  p.intent.move.x = -1;
  for (let i = 0; i < 10; i++) p.step(FIXED_DT, world);
  assert.ok(Math.abs(p.speed - v0) < 1e-9, 'no air control');
  assert.ok(Math.abs(p.jumpY - JUMP.H_BLOCK * Math.sin(Math.PI * 11 / 33)) < 1e-9, 'block arc h 0.75');
});

check('crossover burst, stun, steal cooldown, celebrate, dunk tween', () => {
  const h = new Player({ team: TEAMS[0], teamIdx: 0, index: 0, data: TEAMS[0].players[0], humanoid: null });
  const d = new Player({ team: TEAMS[1], teamIdx: 1, index: 0, data: TEAMS[1].players[0], humanoid: null });
  h.reset(0, -6, Math.PI); d.reset(0.6, -7, 0);   // defender on the handler's LEFT (facing -z, right = -x)
  h.hasBall = true; h.ballMode = 'dribble';
  const world = { players: [h, d], offense: 0, rng: new Rng(1) };
  h.intent.tertiary.justPressed = true;
  h.step(FIXED_DT, world);
  clearEdges(h.intent);
  assert.equal(h.state, 'cross');
  assert.equal(h.crossJustStarted, true);
  assert.equal(h.handSign, -1);
  assert.ok(h.vel.x < -7.4, 'burst away from the defender at 7.5 m/s: vx ' + h.vel.x);
  h.intent.tertiary.justPressed = true;
  h.step(FIXED_DT, world);
  clearEdges(h.intent);
  assert.equal(h.crossJustStarted, false, 'cooldown blocks a second crossover');
  for (let i = 0; i < 25; i++) h.step(FIXED_DT, world);
  assert.notEqual(h.state, 'cross');
  assert.ok(h.pos.x < -2.7 && h.pos.x > -3.2, 'burst distance (2.6 m burst + short coast) ' + h.pos.x);
  assert.ok(h.speed <= MOVE.RUN * MOVE.HANDLER_MUL * TEAMS[0].players[0].speed + 1e-9, 'capped after the burst: ' + h.speed);

  assert.equal(d.stun(0.40), true);
  d.intent.move.x = 1; d.intent.move.mag = 1;
  for (let i = 0; i < 12; i++) d.step(FIXED_DT, world);
  assert.equal(d.state, 'stunned');
  assert.equal(d.speed, 0);
  for (let i = 0; i < 14; i++) d.step(FIXED_DT, world);
  assert.notEqual(d.state, 'stunned');
  d.intent.move.mag = 0; d.intent.move.x = 0;
  for (let i = 0; i < 60; i++) d.step(FIXED_DT, world);
  assert.equal(d.startSteal(), true);
  assert.equal(d.state, 'steal');
  assert.equal(d.startSteal(), false, 'cooldown');
  for (let i = 0; i < 30; i++) d.step(FIXED_DT, world);
  assert.equal(d.state, 'idle');
  for (let i = 0; i < 30; i++) d.step(FIXED_DT, world);
  assert.equal(d.startSteal(), true, 'after 0.7 s');

  h.celebrate();
  assert.equal(h.state, 'celebrate');
  for (let i = 0; i < 50; i++) h.step(FIXED_DT, world);
  assert.equal(h.state, 'idle');

  h.reset(0, -11.5, Math.PI);
  h.startDunk();
  assert.equal(h.state, 'dunk');
  let peak = 0;
  for (let i = 0; i < 20; i++) { h.step(FIXED_DT, world); peak = Math.max(peak, h.jumpY); }
  assert.ok(h.dunkT > 0.3 && h.dunkT < 0.35);
  for (let i = 0; i < 14; i++) { h.step(FIXED_DT, world); peak = Math.max(peak, h.jumpY); }
  assert.ok(Math.abs(peak - SHOT.DUNK_H) < 0.01, 'dunk peak ' + peak);
  assert.equal(h.state, 'idle');
  assert.ok(Math.abs(h.pos.z - (RIM.z + SHOT.DUNK_STOP)) < 1e-6, 'lands at RIM - fwd*0.55: z ' + h.pos.z);
});

check('position history ring buffer, separation, AI clamp, intent helpers', () => {
  const a = new Player({ team: TEAMS[0], teamIdx: 0, index: 0, data: TEAMS[0].players[0], humanoid: null });
  const b = new Player({ team: TEAMS[1], teamIdx: 1, index: 0, data: TEAMS[1].players[0], humanoid: null });
  a.reset(0, -6, Math.PI);
  const world = { players: [a, b], offense: 0, rng: new Rng(1) };
  a.intent.move.x = 1; a.intent.move.mag = 1;
  for (let i = 0; i < 60; i++) a.step(FIXED_DT, world);
  const out = { x: 0, z: 0 };
  a.getDelayed(out, 0);
  assert.ok(Math.abs(out.x - a.prevPos.x) < 1e-9, 'delay 0 = position at the start of this step');
  a.getDelayed(out, 0.25);
  assert.ok(out.x < a.pos.x - 1.0 && out.x > a.pos.x - 1.5, 'delayed 0.25 s: ' + out.x + ' vs ' + a.pos.x);
  a.getDelayed(out, 9);
  assert.ok(out.x < a.pos.x - 1.5, 'clamped to the 0.5 s window');

  a.reset(0, -6, 0); b.reset(0.4, -6, 0);
  Player.resolveSeparation([a, b]);
  assert.ok(Math.abs((b.pos.x - a.pos.x) - MOVE.SEPARATION) < 1e-9, 'pushed to 0.80 m apart');
  assert.ok(Math.abs(a.pos.x + 0.2) < 1e-9 && Math.abs(b.pos.x - 0.6) < 1e-9, 'half the overlap each');

  b.reset(7.9, -0.1, 0);
  b.step(FIXED_DT, world);
  assert.equal(b.pos.x, MOVE.AI_CLAMP_X);
  assert.equal(b.pos.z, MOVE.AI_CLAMP_Z_MAX);
  b.isUser = true;
  b.reset(7.9, -0.1, 0);
  b.step(FIXED_DT, world);
  assert.equal(b.pos.x, 7.9, 'human never clamped');

  const it = makeIntent();
  assert.deepEqual(Object.keys(it), ['move', 'sprint', 'primary', 'secondary', 'tertiary', 'pause']);
  assert.equal(a.stats.fga, 0);
  a.stats.fga = 3; a.resetStats();
  assert.equal(a.stats.fga, 0);
});

check('render interpolates and poses a humanoid; dribble ball position sits beside the hand', () => {
  const hum = createHumanoid(TEAMS[0], 0);
  const p = new Player({ team: TEAMS[0], teamIdx: 0, index: 0, data: TEAMS[0].players[0], humanoid: hum });
  p.reset(1, -6, Math.PI);
  p.offense = true;
  p.prevPos.set(0, 0, -6);
  p.render(0.5, 1.0, FIXED_DT);
  assert.ok(Math.abs(hum.group.position.x - 0.5) < 1e-9);
  assert.equal(hum.pose, 'idle');
  p.hasBall = true; p.ballMode = 'dribble'; p.offense = true;
  p.render(1, 1.1, FIXED_DT);
  assert.equal(hum.pose, 'dribble');
  const v = new THREE.Vector3();
  p.dribbleBallPos(v);
  // facing -z: right = -x, so the right hand (handSign +1) is at x - 0.32, 0.20 ahead (z - 0.20)
  assert.ok(Math.abs(v.x - (1 - 0.32)) < 1e-9 && Math.abs(v.z - (-6.2)) < 1e-9, 'dribble xz ' + v.x + ',' + v.z);
  p.offense = false; p.hasBall = false; p.ballMode = null;
  p.render(1, 1.2, FIXED_DT);
  assert.equal(hum.pose, 'defend');
  p.startWindup('jumper');
  p.render(1, 1.3, FIXED_DT);
  assert.equal(hum.pose, 'windup');
  p.handPoint(v);
  assert.ok(Math.abs(v.z - (-6.25)) < 1e-9 && v.y >= 1.5 && v.y <= 2.05 + 0.55, 'hand point ' + v.y);
});

check('camera: landscape/portrait framing, paint zoom, damping, rim and ball inside NDC', () => {
  const ballPos = new THREE.Vector3(2, 1, -6);
  const world = { ball: { pos: ballPos } };
  const cam = new BroadcastCamera(844 / 390);
  cam.update(FIXED_DT, world);   // first update snaps
  assert.equal(cam.camera.fov, 44);
  assert.ok(Math.abs(cam.camera.position.x - 0.7) < 1e-9 && Math.abs(cam.camera.position.y - 8) < 1e-9);
  assert.ok(Math.abs(cam.camera.position.z - (4.5 + 0.2 * 3)) < 1e-9, 'z ' + cam.camera.position.z);
  const project = (x, y, z) => { cam.camera.updateMatrixWorld(true); const v = new THREE.Vector3(x, y, z).project(cam.camera); return v; };
  let v = project(RIM.x, RIM.y, RIM.z);
  assert.ok(Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1, 'rim in view (landscape) ' + v.x + ',' + v.y);
  v = project(ballPos.x, ballPos.y, ballPos.z);
  assert.ok(Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1, 'ball in view (landscape)');
  // Paint zoom: fov damps toward 40 at rate 3.
  ballPos.set(0, 1, -11);
  cam.update(0.5, world);
  const expected = 44 + (40 - 44) * (1 - Math.exp(-3 * 0.5));
  assert.ok(Math.abs(cam.camera.fov - expected) < 1e-6, 'fov ' + cam.camera.fov);
  for (let i = 0; i < 300; i++) cam.update(FIXED_DT, world);
  assert.ok(Math.abs(cam.camera.fov - 40) < 0.05, 'zoomed fov ' + cam.camera.fov);
  // Portrait.
  cam.setAspect(390 / 844);
  ballPos.set(-7.62, 0.12, -2);
  cam.snapTo(world);
  assert.equal(cam.camera.fov, 70);
  assert.ok(Math.abs(cam.camera.position.x - (-0.8 * 7.62)) < 1e-9 && cam.camera.position.y === 11 && cam.camera.position.z === 8);
  v = project(RIM.x, RIM.y, RIM.z);
  assert.ok(Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1, 'rim in view (portrait) ' + v.x + ',' + v.y);
  v = project(ballPos.x, ballPos.y, ballPos.z);
  assert.ok(Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1, 'ball in view (portrait) ' + v.x + ',' + v.y);
  // Clamping of the ball position.
  ballPos.set(30, 0, 5);
  cam.snapTo(world);
  assert.ok(Math.abs(cam.camera.position.x - 0.8 * 7.62) < 1e-9);
  // Position damping at rate 5.
  cam.setAspect(16 / 9);
  ballPos.set(0, 0, -9);
  cam.snapTo(world);
  ballPos.set(4, 0, -9);
  cam.update(0.2, world);
  assert.ok(Math.abs(cam.camera.position.x - 0.35 * 4 * (1 - Math.exp(-1))) < 1e-9, 'damped x ' + cam.camera.position.x);
});

console.log(passed + ' checks passed');
