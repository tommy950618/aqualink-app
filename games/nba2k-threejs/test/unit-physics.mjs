// Unit checks for physics.js and shot.js (no DOM, no renderer).
// Run: node test/unit-physics.mjs
import assert from 'node:assert/strict';
import {
  integrateBall, collideFloor, collideRim, collideBackboard, testMadeBasket,
  solveArc, apexForDistance, solvePass, predictLanding, stepFreeBall, solveTimed, nearRim,
} from '../src/physics.js';
import {
  classifyShot, contestFactor, makeProbability, timingFactor, chooseTarget, meterDuration,
  baseProbability, greenHalfWidth,
} from '../src/shot.js';
import { RIM, BOARD, BALL, FIXED_DT, SHOT } from '../src/constants.js';
import { Rng } from '../src/math.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

function makeBall(x, y, z, vx = 0, vy = 0, vz = 0) {
  return {
    pos: { x, y, z }, prevPos: { x, y, z }, vel: { x: vx, y: vy, z: vz },
    rimContacts: 0, rimEnabled: true,
  };
}

function flyTo(ball, T) {
  const n = Math.round(T / FIXED_DT);
  for (let i = 0; i < n; i++) integrateBall(ball, FIXED_DT);
  return ball;
}

check('solveArc + integrateBall reaches the rim within 0.06 m at time T', () => {
  const from = { x: 0, y: 2.05, z: -8 };
  const arc = solveArc(from, RIM, 1.6, BALL.G, {});
  assert.ok(arc.T > 1.0 && arc.T < 1.6, 'T ' + arc.T);
  const ball = makeBall(from.x, from.y, from.z, arc.vx, arc.vy, arc.vz);
  flyTo(ball, arc.T);
  const err = Math.hypot(ball.pos.x - RIM.x, ball.pos.y - RIM.y, ball.pos.z - RIM.z);
  assert.ok(err < 0.06, 'arrival error ' + err);
  // Apex actually rises about apexAbove over the higher endpoint.
  const b2 = makeBall(from.x, from.y, from.z, arc.vx, arc.vy, arc.vz);
  let top = 0;
  for (let i = 0; i < 60; i++) { integrateBall(b2, FIXED_DT); top = Math.max(top, b2.pos.y); }
  assert.ok(Math.abs(top - (RIM.y + 1.6)) < 0.08, 'apex ' + top);
  // Also from a wing three, with the spec apex table.
  const wing = { x: 5.4, y: 2.05, z: -7.6 };
  const d = Math.hypot(wing.x - RIM.x, wing.z - RIM.z);
  const arc2 = solveArc(wing, RIM, apexForDistance(d), BALL.G, {});
  const b3 = flyTo(makeBall(wing.x, wing.y, wing.z, arc2.vx, arc2.vy, arc2.vz), arc2.T);
  assert.ok(Math.hypot(b3.pos.x - RIM.x, b3.pos.y - RIM.y, b3.pos.z - RIM.z) < 0.06);
});

check('a ball dropped onto the front rim bounces', () => {
  const rng = new Rng(3);
  const ball = makeBall(RIM.x, RIM.y + 0.6, RIM.z + RIM.r, 0, 0, 0);
  let hit = 0, bounced = false;
  for (let i = 0; i < 90; i++) {
    integrateBall(ball, FIXED_DT);
    const s = collideRim(ball, rng);
    if (s > 0) { hit = s; }
    if (hit > 0 && ball.vel.y > 0) bounced = true;
    if (hit > 0) break;
  }
  assert.ok(hit > 0, 'no rim contact');
  const q = { x: ball.pos.x - RIM.x, z: ball.pos.z - RIM.z };
  const ringDist = Math.hypot(Math.hypot(q.x, q.z) - RIM.r, ball.pos.y - RIM.y);
  assert.ok(bounced || ringDist >= BALL.R + RIM.collideTube - 1e-6, 'ball neither bounced nor left the tube');
  assert.equal(ball.rimContacts, 1);
  // Kick-out after more than 4 contacts in one flight disables the rim.
  const stuck = makeBall(RIM.x, RIM.y + 0.05, RIM.z + RIM.r, 0, -1, 0);
  stuck.rimContacts = 4;
  assert.ok(collideRim(stuck, rng) > 0);
  assert.equal(stuck.rimEnabled, false);
  assert.ok(stuck.vel.y >= 0.5 && Math.abs(Math.hypot(stuck.vel.x, stuck.vel.z) - 2) < 1e-9);
  assert.equal(collideRim(stuck, rng), 0);
});

check('testMadeBasket: through the centre yes, 0.2 m off-centre no', () => {
  const rng = new Rng(1);
  const centre = makeBall(RIM.x, RIM.y + 0.5, RIM.z, 0, -3, 0);
  let scored = false;
  for (let i = 0; i < 60 && !scored; i++) {
    const prevY = centre.pos.y;
    integrateBall(centre, FIXED_DT);
    collideRim(centre, rng);
    scored = testMadeBasket(prevY, centre);
  }
  assert.equal(scored, true);
  const off = makeBall(RIM.x + 0.2, RIM.y + 0.5, RIM.z, 0, -3, 0);
  let scoredOff = false;
  for (let i = 0; i < 60 && !scoredOff; i++) {
    const prevY = off.pos.y;
    integrateBall(off, FIXED_DT);
    scoredOff = testMadeBasket(prevY, off);   // no rim collision: pure geometric test
  }
  assert.equal(scoredOff, false);
  // Upward crossings and crossings from below never count.
  const up = makeBall(RIM.x, RIM.y - 0.01, RIM.z, 0, 3, 0);
  assert.equal(testMadeBasket(RIM.y - 0.05, up), false);
  // stepFreeBall reports the same event through the sub-stepped path.
  const s = makeBall(RIM.x, RIM.y + 0.3, RIM.z, 0, -3, 0);
  let flag = false;
  for (let i = 0; i < 30 && !flag; i++) flag = stepFreeBall(s, FIXED_DT, rng).scored;
  assert.equal(flag, true);
});

check('makeProbability matches the section 4.3 sanity values', () => {
  const p1 = makeProbability('jumper', 4.5, 0, 1, 1, 0, 1, 0.06);
  assert.ok(Math.abs(p1 - 0.96) <= 0.02, '4.5 m green open: ' + p1);
  const p2 = makeProbability('jumper', 7.3, 0, 1, 1, 0, 1, 0.06);
  assert.ok(Math.abs(p2 - 0.74) <= 0.03, '7.3 m green open: ' + p2);
  const p3 = makeProbability('jumper', 4.5, -0.35, 1, 1, 0, 1, 0.06);
  assert.ok(Math.abs(p3 - 0.12) <= 0.03, '4.5 m very early: ' + p3);
  assert.equal(makeProbability('dunk', 1, 0.5, 0.45), 1);
  // Modifiers: fatigue, movement (not for layups), rating, contest, clamps.
  const open = makeProbability('jumper', 4.5, 0, 1, 1, 0, 1, 0.06);
  assert.ok(Math.abs(makeProbability('jumper', 4.5, 0, 1, 0.2, 0, 1, 0.06) - open * 0.9) < 1e-9);
  assert.ok(Math.abs(makeProbability('jumper', 4.5, 0, 1, 1, 3, 1, 0.06) - open * 0.85) < 1e-9);
  assert.ok(Math.abs(makeProbability('layup', 0.5, 0, 1, 1, 3, 1, 0.06) - makeProbability('layup', 1.0, 0, 1, 1, 0, 1, 0.06)) < 1e-12);
  assert.equal(makeProbability('jumper', 1.0, 0, 1, 1, 0, 1.1, 0.06), SHOT.P_MAX);
  assert.equal(makeProbability('jumper', 12, 0.5, 0.45, 0.1, 5, 0.9, 0.05), SHOT.P_MIN);
  assert.equal(timingFactor(0.06, 0.06), 1.6);
  assert.ok(Math.abs(timingFactor(0.30, 0.06) - 0.30) < 1e-12);
  assert.equal(timingFactor(0.31, 0.06), 0.20);
  assert.ok(Math.abs(timingFactor(0.18, 0.06) - 0.95) < 1e-9);
  assert.ok(Math.abs(greenHalfWidth('layup', 0.06) - 0.10) < 1e-12);
  assert.ok(Math.abs(baseProbability(4.5) - 0.598) < 1e-3);
  assert.ok(Math.abs(baseProbability(10) - 0.24) < 1e-12);
  assert.equal(baseProbability(20), 0.10);
});

check('chooseTarget: makes land on the rim, early misses fall short', () => {
  const rng = new Rng(5);
  const shooter = { x: 2.5, z: -6.0 };
  const dShooter = Math.hypot(shooter.x - RIM.x, shooter.z - RIM.z);
  for (let i = 0; i < 200; i++) {
    const t = chooseTarget(true, 0, 1, 'jumper', shooter, rng, {});
    assert.ok(Math.hypot(t.x - RIM.x, t.z - RIM.z) <= 0.05 + 1e-9, 'make off rim');
    assert.equal(t.y, RIM.y);
    const l = chooseTarget(true, 0, 1, 'layup', shooter, rng, {});
    assert.ok(Math.hypot(l.x - RIM.x, l.z - RIM.z) <= 0.04 + 1e-9, 'layup make off rim');
  }
  for (let i = 0; i < 200; i++) {
    const t = chooseTarget(false, -0.15, 0.7, 'jumper', shooter, rng, {});
    const dTarget = Math.hypot(t.x - shooter.x, t.z - shooter.z);
    assert.ok(dTarget <= dShooter - RIM.r, 'early miss not short: ' + (dShooter - dTarget));
    const a = chooseTarget(false, -0.40, 1, 'three', shooter, rng, {});
    assert.ok(Math.abs(Math.hypot(a.x - RIM.x, a.z - RIM.z) - 0.45) < 0.06, 'air ball distance');
    const late = chooseTarget(false, 0.15, 1, 'jumper', shooter, rng, {});
    assert.ok(Math.hypot(late.x - shooter.x, late.z - shooter.z) >= dShooter + RIM.r, 'late miss not long');
    const green = chooseTarget(false, 0.0, 1, 'jumper', shooter, rng, {});
    assert.ok(Math.hypot(green.x - shooter.x, green.z - shooter.z) >= dShooter + RIM.r, 'green miss treated as late');
    const lay = chooseTarget(false, 0.0, 1, 'layup', shooter, rng, {});
    assert.ok(Math.hypot(lay.x - shooter.x, lay.z - shooter.z) < dShooter - RIM.r, 'layup miss short');
  }
  const dunk = chooseTarget(false, 0, 1, 'dunk', shooter, rng, {});
  assert.equal(dunk.x, RIM.x); assert.equal(dunk.z, RIM.z);
  assert.equal(meterDuration('jumper'), 0.55);
  assert.equal(meterDuration('three'), 0.55);
  assert.equal(meterDuration('layup'), 0.40);
});

check('an early miss aimed by chooseTarget actually hits the front rim when flown', () => {
  const rng = new Rng(11);
  const shooter = { x: 0, z: -8.3 };
  const from = { x: 0, y: 2.05, z: -8.05 };
  let rimHits = 0, airballs = 0;
  const trials = 20;
  for (let i = 0; i < trials; i++) {
    const t = chooseTarget(false, -0.15, 1, 'jumper', shooter, rng, {});
    const arc = solveArc(from, t, apexForDistance(4.45), BALL.G, {});
    const ball = makeBall(from.x, from.y, from.z, arc.vx, arc.vy, arc.vz);
    let hit = false;
    for (let s = 0; s < 240 && !hit; s++) {
      const ev = stepFreeBall(ball, FIXED_DT, rng);
      hit = ev.rim > 0 || ev.board > 0;
      if (ball.pos.y <= BALL.R + 1e-6 && ball.vel.y === 0) break;
    }
    if (hit) rimHits++;
  }
  assert.equal(rimHits, trials, 'rim/board contacts ' + rimHits + '/' + trials);
  for (let i = 0; i < 10; i++) {
    const t = chooseTarget(false, -0.40, 1, 'jumper', shooter, rng, {});
    const arc = solveArc(from, t, apexForDistance(4.45), BALL.G, {});
    const ball = makeBall(from.x, from.y, from.z, arc.vx, arc.vy, arc.vz);
    let hit = false;
    for (let s = 0; s < 240 && !hit; s++) {
      const ev = stepFreeBall(ball, FIXED_DT, rng);
      hit = ev.rim > 0 || ev.board > 0;
      if (ball.pos.y <= BALL.R + 1e-6 && ball.vel.y === 0) break;
    }
    if (!hit) airballs++;
  }
  assert.ok(airballs >= 6, 'air balls ' + airballs + '/10');
});

check('a made shot flown through stepFreeBall scores', () => {
  const rng = new Rng(21);
  const shooter = { x: 0, z: -4.8 };
  const from = { x: 0, y: 2.6, z: -5.05 };
  let makes = 0;
  for (let i = 0; i < 40; i++) {
    const t = chooseTarget(true, 0, 1, 'three', shooter, rng, {});
    const arc = solveArc(from, t, apexForDistance(7.95), BALL.G, {});
    const ball = makeBall(from.x, from.y, from.z, arc.vx, arc.vy, arc.vz);
    let scored = false;
    for (let s = 0; s < 240 && !scored; s++) {
      scored = stepFreeBall(ball, FIXED_DT, rng).scored;
      if (ball.pos.y <= BALL.R + 1e-6 && ball.vel.y === 0) break;
    }
    if (scored) makes++;
  }
  assert.equal(makes, 40, 'makes ' + makes + '/40');
});

check('floor: bounce, settle, roll and rest; ball never sinks below its radius', () => {
  const ball = makeBall(0, 1.5, -6, 2, 0, 0);
  let bounces = 0, minY = Infinity, steps = 0;
  while (steps++ < 60 * 8) {
    integrateBall(ball, FIXED_DT);
    if (collideFloor(ball, FIXED_DT) > 0) bounces++;
    minY = Math.min(minY, ball.pos.y);
    if (ball.vel.x === 0 && ball.vel.y === 0 && ball.pos.y === BALL.R) break;
  }
  assert.ok(bounces >= 3 && bounces <= 12, 'bounces ' + bounces);
  assert.ok(minY >= BALL.R - 1e-9, 'minY ' + minY);
  assert.equal(ball.vel.x, 0);
  assert.equal(ball.pos.y, BALL.R);
  assert.ok(steps < 60 * 8, 'ball did not come to rest');
  // A rolling ball decays smoothly without bounce events.
  const roll = makeBall(0, BALL.R, -6, 3, 0, 0);
  let ev = 0;
  for (let i = 0; i < 30; i++) { integrateBall(roll, FIXED_DT); if (collideFloor(roll, FIXED_DT) > 0) ev++; }
  assert.equal(ev, 0);
  const expectRoll = 3 * Math.pow((1 - 2.5 * FIXED_DT) * (1 - BALL.DRAG * FIXED_DT), 30);   // roll decay x integrator drag
  assert.ok(Math.abs(roll.vel.x - expectRoll) < 1e-9, 'roll speed ' + roll.vel.x);
  assert.equal(roll.pos.y, BALL.R);
});

check('backboard reflects a ball moving into its front face', () => {
  const ball = makeBall(0.3, 3.3, BOARD.max.z + BALL.R - 0.02, 0.5, 1, -4);
  const s = collideBackboard(ball);
  assert.ok(Math.abs(s - 4) < 1e-9, 'impact ' + s);
  assert.ok(ball.vel.z > 0 && Math.abs(ball.vel.z - 2.4) < 1e-9, 'vz ' + ball.vel.z);
  assert.ok(Math.abs(ball.vel.x - 0.45) < 1e-9 && Math.abs(ball.vel.y - 0.9) < 1e-9);
  assert.ok(Math.abs(ball.pos.z - (BOARD.max.z + BALL.R)) < 1e-9);
  const far = makeBall(0, 3.3, -10, 0, 0, -4);
  assert.equal(collideBackboard(far), 0);
  const disabled = makeBall(0.3, 3.3, BOARD.max.z + BALL.R - 0.02, 0, 0, -4);
  disabled.boardEnabled = false;
  assert.equal(collideBackboard(disabled), 0);
});

check('solvePass caps chest-pass time at max(dist/12, 0.30) and lobs rise 1.8 m', () => {
  const from = { x: -3, y: 2.05, z: -7 };
  const to = { x: 3, y: 1.3, z: -8 };
  const dist = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  const chest = solvePass(from, to, false, {});
  assert.ok(Math.abs(chest.T - Math.max(dist / 12, 0.30)) < FIXED_DT, 'T ' + chest.T);
  const ball = flyTo(makeBall(from.x, from.y, from.z, chest.vx, chest.vy, chest.vz), chest.T);
  assert.ok(Math.hypot(ball.pos.x - to.x, ball.pos.y - to.y, ball.pos.z - to.z) < 0.03);
  const near = { x: -2.5, y: 1.3, z: -7 };
  const short = solvePass(from, near, false, {});
  assert.ok(Math.abs(short.T - 0.30) < FIXED_DT, 'short T ' + short.T);
  const lob = solvePass(from, to, true, {});
  assert.ok(lob.T > chest.T);
  const lb = makeBall(from.x, from.y, from.z, lob.vx, lob.vy, lob.vz);
  let top = 0;
  for (let i = 0; i < Math.round(lob.T / FIXED_DT); i++) { integrateBall(lb, FIXED_DT); top = Math.max(top, lb.pos.y); }
  assert.ok(Math.abs(top - (from.y + 1.8)) < 0.08, 'lob apex ' + top);
  assert.ok(Math.hypot(lb.pos.x - to.x, lb.pos.y - to.y, lb.pos.z - to.z) < 0.03);
  const timed = solveTimed(from, to, 0.5, BALL.G, {});
  assert.equal(timed.T, Math.round(0.5 / FIXED_DT) * FIXED_DT);
});

check('predictLanding finds the descending crossing and returns null when unreachable', () => {
  const ball = makeBall(1, 2.5, -9, 2, 6, -1);
  const land = predictLanding(ball, 1.8, {});
  assert.ok(land && land.t > 0);
  const t = land.t;
  const y = ball.pos.y + ball.vel.y * t - 0.5 * BALL.G * t * t;
  assert.ok(Math.abs(y - 1.8) < 1e-9);
  assert.ok(ball.vel.y - BALL.G * t < 0, 'not descending');
  assert.ok(Math.abs(land.x - (1 + 2 * t)) < 1e-9 && Math.abs(land.z - (-9 - t)) < 1e-9);
  assert.equal(predictLanding(makeBall(0, 1.0, -9, 0, -3, 0), 1.8, {}), null);
  assert.equal(predictLanding(makeBall(0, 1.0, -9, 0, 2, 0), 1.8, {}), null);
  const above = predictLanding(makeBall(0, 4.0, -9, 0, -2, 0), 1.8, {});
  assert.ok(above && above.t > 0);
  assert.equal(nearRim({ x: RIM.x, y: RIM.y + 1.0, z: RIM.z }), true);
  assert.equal(nearRim({ x: RIM.x, y: RIM.y, z: RIM.z + 1.3 }), false);
});

check('classifyShot and contestFactor over a small world', () => {
  const mk = (team, x, z, extra = {}) => ({
    pos: { x, y: 0, z }, team, isJumping: false, sprintedRecently: false, stamina: 1,
    vel: { x: 0, y: 0, z: 0 }, data: { dunk: 0.9, shooting: 1, defense: 1 }, ...extra,
  });
  const shooter = mk(0, 0, -8.3);
  const world = { players: [shooter], ball: null, offense: 0, rimXZ: { x: RIM.x, z: RIM.z } };
  assert.equal(classifyShot(shooter, world), 'jumper');
  shooter.pos.z = -4.8;
  assert.equal(classifyShot(shooter, world), 'three');
  shooter.pos.z = RIM.z + 1.5;
  assert.equal(classifyShot(shooter, world), 'layup');
  shooter.sprintedRecently = true;
  assert.equal(classifyShot(shooter, world), 'dunk');
  shooter.data.dunk = 0.4;
  assert.equal(classifyShot(shooter, world), 'layup');
  shooter.data.dunk = 0.9;
  const lane = mk(1, 0.3, RIM.z + 0.7);
  world.players.push(lane);
  assert.equal(classifyShot(shooter, world), 'layup');
  lane.team = 0;
  assert.equal(classifyShot(shooter, world), 'dunk');
  world.players.length = 1;
  shooter.pos.z = -8.3;
  shooter.sprintedRecently = false;
  let c = contestFactor(shooter, world, {});
  assert.equal(c.C, 1); assert.equal(c.defender, null);
  const def = mk(1, 0, -9.0);
  world.players.push(def);
  c = contestFactor(shooter, world, {});
  assert.equal(c.defender, def);
  assert.ok(Math.abs(c.C - (0.45 + 0.55 * (0.7 - 0.5) / 1.5)) < 1e-9, 'C ' + c.C);
  def.isJumping = true;
  const cj = contestFactor(shooter, world, {}).C;
  assert.ok(Math.abs(cj - c.C * 0.8) < 1e-9);
  def.pos.z = -7.6;                     // behind the shooter: not a contest
  assert.equal(contestFactor(shooter, world, {}).C, 1);
  def.pos.z = -9.0; def.isJumping = false;
  def.pos.z = -11.5;                    // 3.2 m in front: open
  assert.equal(contestFactor(shooter, world, {}).C, 1);
  def.pos.z = -8.7;                     // 0.4 m: fully contested
  assert.equal(contestFactor(shooter, world, {}).C, 0.45);
  const p = makeProbability('jumper', 4.45, 0, cj, 1, 0, 1, 0.06);
  assert.ok(p < 0.7, 'contested jumper ' + p);
});

console.log(passed + ' checks passed');
