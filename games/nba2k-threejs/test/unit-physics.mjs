// Unit checks for physics.js v2 (no DOM, no renderer): the integrator and the timed / apex arc solvers, rim (v2
// restitution 0.40, tangential 0.80, kick-out), backboard (0.50), floor, made-basket detection, the §5.3.7 miss
// targets flown through the physics (early misses hit the rim, green misses short or long, air balls drop in front
// of the rim without touching it), §5.5 passes (flight max(dist/speed, 0.25), lob apex 1.8 m), predictLanding, and the
// §5.2 / C3 separation (bodyR sums, +0.10 airborne, 0.95 m against a hanging dunker, immovable players, box-out
// favour, AI court clamp).
// Run: node test/unit-physics.mjs
import assert from 'node:assert/strict';
import {
  integrateBall, collideFloor, collideRim, collideBackboard, testMadeBasket, solveArc, apexForDistance, solvePass,
  predictLanding, stepFreeBall, solveTimed, nearRim, pairMinDistance, resolveSeparation, RIM_TANGENTIAL,
} from '../src/physics.js';
import { chooseTarget, airBallTarget } from '../src/shot.js';
import { RIM, BOARD, BALL, FIXED_DT, RIM_PHYS, SEPARATION, MOVE, REBOUND } from '../src/constants.js';
import { Rng } from '../src/math.js';
import { LEGENDS } from '../src/legends.js';
import { derive } from '../src/ratings.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (±${tol})`);

function makeBall(x, y, z, vx = 0, vy = 0, vz = 0) {
  return { pos: { x, y, z }, prevPos: { x, y, z }, vel: { x: vx, y: vy, z: vz }, rimContacts: 0, rimEnabled: true };
}
function flyTo(ball, T) {
  const n = Math.round(T / FIXED_DT);
  for (let i = 0; i < n; i++) integrateBall(ball, FIXED_DT);
  return ball;
}
/** Flies a shot to its target; returns { rim, board, scored, firstFloor (distance from the rim), restInside }. */
function flyShot(from, target, rng) {
  const d = Math.hypot(from.x - RIM.x, from.z - RIM.z);
  const arc = solveArc(from, target, apexForDistance(d), BALL.G, {});
  const ball = makeBall(from.x, from.y, from.z, arc.vx, arc.vy, arc.vz);
  ball.boardEnabled = true;
  const out = { rim: false, board: false, scored: false, firstFloor: -1 };
  for (let s = 0; s < 600; s++) {
    const ev = stepFreeBall(ball, FIXED_DT, rng);
    if (ev.rim > 0) out.rim = true;
    if (ev.board > 0) out.board = true;
    if (ev.scored) out.scored = true;
    if (ev.floor > 0 && out.firstFloor < 0) out.firstFloor = Math.hypot(ball.pos.x - RIM.x, ball.pos.z - RIM.z);
    if (ball.pos.y <= BALL.R + 1e-6 && ball.vel.x === 0 && ball.vel.y === 0 && ball.vel.z === 0) break;
  }
  return out;
}
/** A minimal separation participant. */
function body(id, x, z, extra = {}) {
  return Object.assign({ id, legend: LEGENDS[id], attrs: derive(LEGENDS[id]), pos: { x, y: 0, z }, isJumping: false, hanging: false, sepFixed: false, boxT: 0, boxing: null, clampToCourt: false, isUser: false }, extra);
}

check('solveArc + integrateBall reach the target within 0.06 m at time T; the apex rises apexAbove', () => {
  for (const from of [{ x: 0, y: 2.6, z: -8 }, { x: 5.4, y: 2.8, z: -7.6 }, { x: -6.9, y: 2.7, z: -13.0 }]) {
    const d = Math.hypot(from.x - RIM.x, from.z - RIM.z);
    const arc = solveArc(from, RIM, apexForDistance(d), BALL.G, {});
    const ball = flyTo(makeBall(from.x, from.y, from.z, arc.vx, arc.vy, arc.vz), arc.T);
    assert.ok(Math.hypot(ball.pos.x - RIM.x, ball.pos.y - RIM.y, ball.pos.z - RIM.z) < 0.06, 'arrival');
    const b2 = makeBall(from.x, from.y, from.z, arc.vx, arc.vy, arc.vz);
    let top = 0;
    for (let i = 0; i < Math.round(arc.T / FIXED_DT); i++) { integrateBall(b2, FIXED_DT); top = Math.max(top, b2.pos.y); }
    near(top, Math.max(from.y, RIM.y) + apexForDistance(d), 0.08, 'apex');
  }
  assert.deepEqual([apexForDistance(1), apexForDistance(3), apexForDistance(6), apexForDistance(8)], [1.0, 1.6, 2.1, 2.6]);
  const timed = solveTimed({ x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }, 0.5, BALL.G, {});
  assert.equal(timed.T, Math.round(0.5 / FIXED_DT) * FIXED_DT);
});

check('rim v2 (R#31): restitution 0.40 and tangential 0.80 on a normal hit; kick-out after 4 contacts', () => {
  // a ball falling straight onto the top of the tube: purely normal impact → |vy'| = 0.40·|vy| (±5 % jitter)
  const top = makeBall(RIM.x, RIM.y + BALL.R + RIM.collideTube - 0.001, RIM.z + RIM.r, 0, -4, 0);
  const s = collideRim(top, null);
  near(s, 4, 1e-9, 'impact');
  near(top.vel.y, RIM_PHYS.REST_RIM * 4, 1e-9, 'restitution');
  // oblique impact: the tangential component keeps 0.80
  const ob = makeBall(RIM.x, RIM.y + BALL.R + RIM.collideTube - 0.001, RIM.z + RIM.r, 2, -4, 0);
  collideRim(ob, null);
  near(ob.vel.x, 2 * RIM_TANGENTIAL, 1e-9, 'tangential');
  assert.equal(RIM_TANGENTIAL, 0.80);
  const rng = new Rng(3);
  const stuck = makeBall(RIM.x, RIM.y + 0.05, RIM.z + RIM.r, 0, -1, 0);
  stuck.rimContacts = 4;
  assert.ok(collideRim(stuck, rng) > 0);
  assert.equal(stuck.rimEnabled, false);
  assert.ok(stuck.vel.y >= 0.5 && Math.abs(Math.hypot(stuck.vel.x, stuck.vel.z) - 2) < 1e-9);
  assert.equal(collideRim(stuck, rng), 0);
});

check('backboard v2: restitution 0.50 on the front face, tangential 0.90; disabled board ignores the ball', () => {
  const ball = makeBall(0.3, 3.3, BOARD.max.z + BALL.R - 0.02, 0.5, 1, -4);
  const s = collideBackboard(ball);
  near(s, 4, 1e-9);
  near(ball.vel.z, RIM_PHYS.REST_BOARD * 4, 1e-9, 'vz');
  near(ball.vel.x, 0.45, 1e-9); near(ball.vel.y, 0.9, 1e-9);
  near(ball.pos.z, BOARD.max.z + BALL.R, 1e-9);
  assert.equal(collideBackboard(makeBall(0, 3.3, -10, 0, 0, -4)), 0);
  const disabled = makeBall(0.3, 3.3, BOARD.max.z + BALL.R - 0.02, 0, 0, -4);
  disabled.boardEnabled = false;
  assert.equal(collideBackboard(disabled), 0);
});

check('testMadeBasket: through the centre yes, 0.2 m off-centre no, upward never; stepFreeBall reports it', () => {
  const rng = new Rng(1);
  const centre = makeBall(RIM.x, RIM.y + 0.5, RIM.z, 0, -3, 0);
  let scored = false;
  for (let i = 0; i < 60 && !scored; i++) { const y0 = centre.pos.y; integrateBall(centre, FIXED_DT); collideRim(centre, rng); scored = testMadeBasket(y0, centre); }
  assert.equal(scored, true);
  const off = makeBall(RIM.x + 0.2, RIM.y + 0.5, RIM.z, 0, -3, 0);
  let s2 = false;
  for (let i = 0; i < 60 && !s2; i++) { const y0 = off.pos.y; integrateBall(off, FIXED_DT); s2 = testMadeBasket(y0, off); }
  assert.equal(s2, false);
  assert.equal(testMadeBasket(RIM.y - 0.05, makeBall(RIM.x, RIM.y - 0.01, RIM.z, 0, 3, 0)), false);
  const s = makeBall(RIM.x, RIM.y + 0.3, RIM.z, 0, -3, 0);
  let flag = false;
  for (let i = 0; i < 30 && !flag; i++) flag = stepFreeBall(s, FIXED_DT, rng).scored;
  assert.equal(flag, true);
  assert.equal(nearRim({ x: RIM.x, y: RIM.y + 1.0, z: RIM.z }), true);
  assert.equal(nearRim({ x: RIM.x, y: RIM.y, z: RIM.z + 1.3 }), false);
});

check('floor: bounce, settle, roll and rest; the ball never sinks below its radius', () => {
  const ball = makeBall(0, 1.5, -6, 2, 0, 0);
  let bounces = 0, minY = Infinity, steps = 0;
  while (steps++ < 60 * 8) {
    integrateBall(ball, FIXED_DT);
    if (collideFloor(ball, FIXED_DT) > 0) bounces++;
    minY = Math.min(minY, ball.pos.y);
    if (ball.vel.x === 0 && ball.vel.y === 0 && ball.pos.y === BALL.R) break;
  }
  assert.ok(bounces >= 3 && bounces <= 12, 'bounces ' + bounces);
  assert.ok(minY >= BALL.R - 1e-9);
  assert.ok(steps < 60 * 8, 'came to rest');
  const roll = makeBall(0, BALL.R, -6, 3, 0, 0);
  let ev = 0;
  for (let i = 0; i < 30; i++) { integrateBall(roll, FIXED_DT); if (collideFloor(roll, FIXED_DT) > 0) ev++; }
  assert.equal(ev, 0);
  near(roll.vel.x, 3 * Math.pow((1 - 2.5 * FIXED_DT) * (1 - BALL.DRAG * FIXED_DT), 30), 1e-9, 'roll decay');
});

check('miss targets flown (§5.3.7): green makes score, early misses touch rim/board, air balls never do (R#30)', () => {
  const rng = new Rng(21);
  const from = { x: 0, y: 2.85, z: -5.05 };          // a top-of-the-key three released at the hand
  let makes = 0;
  for (let i = 0; i < 40; i++) { const t = chooseTarget(true, 0, 0.035, 'jumper', 0, -4.8, 1, rng, {}); if (flyShot(from, t, rng).scored) makes++; }
  assert.equal(makes, 40, 'makes');
  const mid = { x: 0, y: 2.8, z: -8.05 };
  let touched = 0;
  for (let i = 0; i < 20; i++) { const t = chooseTarget(false, -0.12, 0.035, 'jumper', 0, -8.3, 1, rng, {}); const r = flyShot(mid, t, rng); if (r.rim || r.board) touched++; }
  assert.equal(touched, 20, 'early misses contact the rim or board');
  let clean = 0, inside = 0;
  for (let i = 0; i < 20; i++) {
    const t = airBallTarget(0, -8.3, rng, {});
    near(t.y, RIM.y - 0.55, 1e-9);
    const r = flyShot(mid, t, rng);
    if (!r.rim && !r.board) clean++;
    if (r.firstFloor >= 0 && r.firstFloor < 4.5) inside++;
  }
  assert.equal(clean, 20, 'air balls never touch the rim');
  assert.ok(inside >= 16, `air balls land near the rim (${inside}/20)`);
  // green misses go short or long with p 0.5 (R#32)
  let shortN = 0;
  for (let i = 0; i < 400; i++) {
    const t = chooseTarget(false, 0, 0.035, 'jumper', 0, -8.3, 1, rng, {});
    if (Math.hypot(t.x - RIM.x, t.z - RIM.z) > 0 && (t.z - RIM.z) > 0) shortN++;
  }
  near(shortN / 400, 0.5, 0.08, 'green misses short');
});

check('passes (§5.5): chest flight max(dist/speed, 0.25) at passSpeed, arrival within 0.03 m; lob apex 1.8 m', () => {
  const from = { x: -3, y: 1.3, z: -7 };
  const to = { x: 3, y: 1.3, z: -8 };
  const dist = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  for (const speed of [12.0, 13.9, 15]) {
    const chest = solvePass(from, to, false, speed, {});
    assert.ok(Math.abs(chest.T - Math.max(dist / speed, 0.25)) < FIXED_DT, 'T ' + chest.T);
    const b = flyTo(makeBall(from.x, from.y, from.z, chest.vx, chest.vy, chest.vz), chest.T);
    assert.ok(Math.hypot(b.pos.x - to.x, b.pos.y - to.y, b.pos.z - to.z) < 0.03);
  }
  const short = solvePass(from, { x: -2.2, y: 1.3, z: -7 }, false, 13, {});
  assert.ok(Math.abs(short.T - 0.25) < FIXED_DT, 'minimum flight 0.25 s');
  const lob = solvePass(from, to, true, 13, {});
  const lb = makeBall(from.x, from.y, from.z, lob.vx, lob.vy, lob.vz);
  let top = 0;
  for (let i = 0; i < Math.round(lob.T / FIXED_DT); i++) { integrateBall(lb, FIXED_DT); top = Math.max(top, lb.pos.y); }
  near(top, from.y + 1.8, 0.08, 'lob apex');
  assert.ok(Math.hypot(lb.pos.x - to.x, lb.pos.y - to.y, lb.pos.z - to.z) < 0.03);
});

check('predictLanding finds the descending crossing and returns null when unreachable', () => {
  const ball = makeBall(1, 2.5, -9, 2, 6, -1);
  const land = predictLanding(ball, 1.8, {});
  assert.ok(land && land.t > 0);
  const t = land.t;
  near(ball.pos.y + ball.vel.y * t - 0.5 * BALL.G * t * t, 1.8, 1e-9);
  assert.ok(ball.vel.y - BALL.G * t < 0);
  assert.equal(predictLanding(makeBall(0, 1.0, -9, 0, -3, 0), 1.8, {}), null);
  assert.ok(predictLanding(makeBall(0, 4.0, -9, 0, -2, 0), 1.8, {}).t > 0);
});

check('separation (C3): pair minimum bodyR_a + bodyR_b, +0.10 airborne, ≥ 0.95 m vs a hanging dunker', () => {
  const a = body('kyrie', 0, -6), b = body('lebron', 0.3, -6);
  near(pairMinDistance(a, b), a.attrs.bodyR + b.attrs.bodyR, 1e-12);
  assert.ok(pairMinDistance(a, b) > 0.79 - 1e-9 && pairMinDistance(a, b) < 0.87 + 1e-9);
  a.isJumping = true;
  near(pairMinDistance(a, b), a.attrs.bodyR + b.attrs.bodyR + SEPARATION.AIR_ADD, 1e-12);
  a.isJumping = false; a.hanging = true;
  near(pairMinDistance(a, b), Math.max(SEPARATION.DUNKER_MIN, a.attrs.bodyR + b.attrs.bodyR), 1e-12);
  // the push splits the overlap in half for free bodies
  const c = body('kobe', 0, -6), d = body('jordan', 0.5, -6);
  resolveSeparation([c, d]);
  near(d.pos.x - c.pos.x, c.attrs.bodyR + d.attrs.bodyR, 1e-9, 'resolved distance');
  near(c.pos.x, -(c.attrs.bodyR + d.attrs.bodyR - 0.5) / 2, 1e-9, 'half each');
});

check('separation: hanging dunker / root-motion signature clip immovable; box-out favour 0.3 + 0.004·strDiff', () => {
  const dunker = body('giannis', 0, -12, { hanging: true, sepFixed: true }), o = body('kobe', 0.4, -12);
  resolveSeparation([dunker, o]);
  near(dunker.pos.x, 0, 1e-12, 'dunker immovable');
  near(o.pos.x, SEPARATION.DUNKER_MIN, 1e-9, 'the other takes the whole push to 0.95 m');
  const boxer = body('yao', 0, -11), man = body('kyrie', 0.5, -11);
  boxer.boxT = 0.4; boxer.boxing = man;
  resolveSeparation([boxer, man]);
  const over = boxer.attrs.bodyR + man.attrs.bodyR - 0.5;
  const f = Math.min(0.9, REBOUND.BOX_BASE + REBOUND.BOX_K * (LEGENDS.yao.ratings.strength - LEGENDS.kyrie.ratings.strength));
  near(-boxer.pos.x, over * (1 - f) / 2, 1e-9, 'boxer moves (1 − f)/2');
  near(man.pos.x - 0.5, over * (1 + f) / 2, 1e-9, 'the other (1 + f)/2');
  // AI clamp after separation; the human is not clamped
  const ai = body('lebron', 7.9, -6, { clampToCourt: true }), hu = body('kobe', -7.9, -6, { clampToCourt: true, isUser: true });
  resolveSeparation([ai, hu]);
  near(ai.pos.x, MOVE.AI_CLAMP_X, 1e-12); near(hu.pos.x, -7.9, 1e-12);
});

console.log(`unit-physics: ${passed} checks passed`);
