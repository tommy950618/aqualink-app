// Unit checks for src/ai.js (no DOM, no renderer). A tiny game-like harness resolves the CPU intents
// the way game.js will (shots, passes, steals, catches, dead balls) so the AI can be exercised end to end.
// Run: node test/unit-ai.mjs   (add --expose-gc for the allocation check)
import assert from 'node:assert/strict';
import { Player } from '../src/player.js';
import { Ball } from '../src/ball.js';
import { updateAI, assignDefense, openness, laneBlocked, bestPassTarget, steerTo, pickSlot } from '../src/ai.js';
import { solveArc, solveTimed, apexForDistance } from '../src/physics.js';
import { classifyShot, meterDuration, makeProbability, chooseTarget, contestFactor, shotDistance } from '../src/shot.js';
import { RIM, BALL, FIXED_DT, SLOTS, FORMATION, DIFFICULTY, MOVE, isThree, CLOCK, SHOT } from '../src/constants.js';
import { Rng, lerp } from '../src/math.js';
import { TEAMS } from '../src/teams.js';

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('ok - ' + name); }
const dxz = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

class Sim {
  constructor(seed, { auto = true, difficulty = 'normal' } = {}) {
    this.rng = new Rng(seed);
    this.players = [];
    for (let t = 0; t < 2; t++) for (let i = 0; i < 3; i++) {
      this.players.push(new Player({ team: TEAMS[t], teamIdx: t, index: i, data: TEAMS[t].players[i] }));
    }
    this.ball = new Ball(null, this.rng);
    const w = this.world = {
      players: this.players, teams: TEAMS, ball: this.ball, offense: 0, user: 0, userPlayer: this.players[0],
      controlled: null, quarter: 1, gameClock: 120, shotClock: 14, state: 'MENU', deadReason: '',
      difficulty: DIFFICULTY[difficulty], rng: this.rng, time: 0, auto, rimXZ: RIM, slots: SLOTS,
      isUserControlled: (p) => !auto && p === w.controlled,
    };
    this.score = [0, 0];
    this.stat = { fga: [0, 0], fgm: [0, 0], passes: 0, lobs: 0, stealTries: 0, steals: 0, crosses: 0, blocks: 0,
      intercepts: 0, holds: [], maxFree: 0, maxMove: 0, deadReasons: {}, contestJumps: 0, rebJumps: 0, cuts: 0 };
    this.freeT = 0; this.events = []; this.deadT = 0; this.checkT = 0;
    this.check();
  }

  check() {
    const w = this.world, off = w.offense;
    const att = this.players.filter((p) => p.team === off), def = this.players.filter((p) => p.team !== off);
    att[0].reset(FORMATION.HANDLER.x, FORMATION.HANDLER.z, FORMATION.OFFENSE_YAW);
    att[1].reset(SLOTS.leftWing.x, SLOTS.leftWing.z, FORMATION.OFFENSE_YAW);
    att[2].reset(SLOTS.rightWing.x, SLOTS.rightWing.z, FORMATION.OFFENSE_YAW);
    for (let i = 0; i < 3; i++) def[i].reset(lerp(att[i].pos.x, RIM.x, 0.18), lerp(att[i].pos.z, RIM.z, 0.18), FORMATION.DEFENSE_YAW);
    for (const p of this.players) { p.isUser = !w.auto && p === w.controlled; p.slot = -1; p.cutting = false; }
    this.ball.attachTo(att[0], 'held');
    assignDefense(w);
    w.state = 'CHECK'; this.checkT = 0; w.shotClock = CLOCK.SHOT;
    this.freeT = 0;
  }

  dead(reason, nextOffense) {
    const w = this.world;
    if (w.state !== 'LIVE') return;
    w.state = 'DEAD'; w.deadReason = reason; this.deadT = 0;
    this.stat.deadReasons[reason] = (this.stat.deadReasons[reason] || 0) + 1;
    if (typeof nextOffense === 'number') w.offense = nextOffense;
  }

  step() {
    const w = this.world, ball = this.ball, dt = FIXED_DT, rng = this.rng;
    w.time += dt;
    if (w.state === 'CHECK') { this.checkT += dt; if (this.checkT >= CLOCK.CHECK) w.state = 'LIVE'; }
    else if (w.state === 'DEAD') { this.deadT += dt; if (this.deadT >= 1.0) this.check(); }
    if (w.state === 'LIVE') {
      w.shotClock = Math.max(0, w.shotClock - dt); w.gameClock -= dt;
      const lastOff = ball.lastToucher ? ball.lastToucher.team : w.offense;
      if (w.shotClock <= 0 && (ball.isHeld || (ball.isFree && ball.state !== 'flight' && lastOff === w.offense))) this.dead('SHOT_CLOCK', 1 - w.offense);
    }
    updateAI(w, dt);
    for (const p of this.players) {
      const it = p.intent;
      const mv = Math.hypot(it.move.x, it.move.z);
      this.stat.maxMove = Math.max(this.stat.maxMove, mv, it.move.mag);
      if (w.state !== 'LIVE') continue;
      if (p.hasBall) this.resolveOffense(p, it);
      else this.resolveDefense(p, it);
    }
    for (const p of this.players) p.step(dt, w);
    Player.resolveSeparation(this.players);
    for (const p of this.players) {
      if (p.crossJustStarted) {
        this.stat.crosses++;
        for (const q of this.players) if (q.team !== p.team && dxz(q.pos, p.pos) < 1.0 && rng.next() < w.difficulty.crossFreeze) q.stun(0.4);
      }
      if (p.state === 'dunk' && p.dunkT >= SHOT.DUNK_BALL_T && p.hasBall) {
        ball.launch({ x: 0, y: -4, z: 0 }, 'flight', { shooter: p, points: 2, kind: 'dunk' }, { x: RIM.x, y: RIM.y + 0.02, z: RIM.z });
      }
    }
    // blocks (section 4.7)
    if (ball.state === 'flight' && ball.releaseAge < SHOT.BLOCK_WINDOW) {
      for (const p of this.players) {
        if (!p.isJumping || p.team === w.offense) continue;
        const h = p.blockHand({ x: 0, y: 0, z: 0 });
        if (Math.hypot(ball.pos.x - h.x, ball.pos.y - h.y, ball.pos.z - h.z) < SHOT.BLOCK_R) {
          ball.launch({ x: -0.3 * ball.vel.x, y: 2.5 + 1.5 * rng.next(), z: -0.3 * ball.vel.z }, 'loose', { toucher: p });
          p.stats.blk++; this.stat.blocks++;
          break;
        }
      }
    }
    const wasState = ball.state;
    ball.step(dt, w, this.events);
    for (const e of this.events) {
      if (e.type === 'score' && w.state === 'LIVE') {
        const team = e.player.team; this.score[team] += e.value; this.stat.fgm[team]++; e.player.stats.pts += e.value; e.player.stats.fgm++;
        this.dead('MADE', 1 - team);
      } else if (e.type === 'oob' && w.state === 'LIVE') {
        this.dead('OOB', e.player ? 1 - e.player.team : 1 - w.offense);
      } else if (e.type === 'rest' && w.state === 'LIVE') {
        this.dead('REST', e.player ? 1 - e.player.team : 1 - w.offense);
      } else if (e.type === 'nan') {
        throw new Error('ball NaN');
      }
    }
    if (w.state === 'LIVE' && ball.isFree) {
      this.freeT += dt; this.stat.maxFree = Math.max(this.stat.maxFree, this.freeT);
      if (ball.vel.length() < 0.2) { this.slowT = (this.slowT || 0) + dt; if (this.slowT > 1.5) this.dead('REST', ball.lastToucher ? 1 - ball.lastToucher.team : 1 - w.offense); } else this.slowT = 0;
      let best = null, bd = Infinity;
      for (const p of this.players) if (ball.canBeCaughtBy(p, w) && !(ball.state === 'pass' && ball.passInfo.from === p && ball.releaseAge < 0.3)) { const d = dxz(p.pos, ball.pos); if (d < bd) { bd = d; best = p; } }
      if (best) {
        const wasPass = ball.state === 'pass', wasShotBall = ball.state === 'flight' || (ball.state === 'loose');
        ball.attachTo(best, 'held');
        if (best.team !== w.offense) {
          if (wasPass) { best.stats.stl++; this.stat.intercepts++; } else best.stats.reb++;
          this.dead('TURNOVER', best.team);
        } else if (wasShotBall) { w.shotClock = CLOCK.SHOT; }
        this.freeT = 0;
      }
    } else this.freeT = 0;
    for (const p of this.players) {
      assert.ok(Number.isFinite(p.pos.x + p.pos.z + p.vel.x + p.vel.z + p.jumpY), 'finite player state');
      if (p.cutting) this.stat.cuts++;
    }
    assert.ok(Number.isFinite(ball.pos.x + ball.pos.y + ball.pos.z), 'finite ball');
    assert.ok(w.shotClock >= 0 && w.shotClock <= 14, 'shot clock in range');
  }

  resolveOffense(p, it) {
    const w = this.world, ball = this.ball, rng = this.rng;
    if (p.canAct && it.primary.justPressed) {
      const kind = classifyShot(p, w);
      if (kind === 'dunk') p.startDunk(); else p.startWindup(kind);
      p.shotPressTs = it.primary.pressTs;
    } else if ((p.state === 'windup' || p.state === 'layup') && !p.released && (it.primary.justReleased || p.meterF >= SHOT.F_MAX)) {
      const kind = p.shotKind;
      const T = meterDuration(kind);
      const f = it.primary.justReleased ? Math.min(SHOT.F_MAX, (it.primary.releaseTs - p.shotPressTs) / 1000 / T) : SHOT.F_MAX;
      const e = f - SHOT.F_IDEAL;
      this.stat.holds.push(f);
      const { C } = contestFactor(p, w);
      const d = shotDistance(p, w);
      const prob = makeProbability(kind, d, e, C, p.stamina, p.speed, p.data.shooting, w.difficulty.userGreen);
      const make = rng.next() < prob;
      const target = chooseTarget(make, e, C, kind, { x: p.pos.x, z: p.pos.z }, rng, { x: 0, y: 0, z: 0 }, w.difficulty.userGreen);
      const from = p.handPoint({ x: 0, y: 0, z: 0 });
      const arc = solveArc(from, target, apexForDistance(d), BALL.G, {});
      const points = isThree(p.pos.x, p.pos.z) ? 3 : 2;
      ball.launch(arc, 'flight', { shooter: p, releaseTime: w.time, points, kind }, from);
      p.release(); p.stats.fga++; this.stat.fga[p.team]++;
    } else if (p.canAct && it.secondary.justReleased) {
      const recv = p.passTarget || bestPassTarget(p, w);
      if (recv) {
        const lob = it.secondary.heldTime >= 0.30;
        const from = p.chestPoint({ x: 0, y: 0, z: 0 });
        const to = recv.chestPoint({ x: 0, y: 0, z: 0 });
        to.x += recv.vel.x * 0.25; to.z += recv.vel.z * 0.25;
        // game.js must cap chest passes at ~12 m/s: the catch rule rejects |v| >= 14 m/s.
        const arc = solveArc(from, to, lob ? 1.8 : 0.25, BALL.G, {});
        if (!lob) { const dist = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z); const T = Math.max(arc.T, dist / 12, 0.30); if (T > arc.T) solveTimed(from, to, T, BALL.G, arc); }
        ball.launch(arc, 'pass', { receiver: recv, from: p }, from);
        this.stat.passes++; if (lob) this.stat.lobs++;
      }
    }
  }

  resolveDefense(p, it) {
    const w = this.world, ball = this.ball, rng = this.rng;
    if (p.team === w.offense) { if (it.primary.justPressed && p.canAct) this.stat.rebJumps++; return; }
    if (it.primary.justPressed && p.canAct) { if (ball.isHeld && ball.owner && (ball.owner.state === 'windup' || ball.owner.state === 'layup')) this.stat.contestJumps++; else this.stat.rebJumps++; }
    if (it.tertiary.justPressed && p.canAct && p.stealCd <= 0) {
      const h = ball.owner;
      if (!h || !ball.isHeld) return;
      this.stat.stealTries++;
      if (dxz(p.pos, h.pos) >= MOVE.STEAL_RANGE || h.ballMode !== 'dribble' || h.state === 'cross') return;
      p.startSteal();
      let ps = w.difficulty.stealRate;
      if (h.dribbleY < MOVE.STEAL_LOW_Y) ps += MOVE.STEAL_LOW_BONUS;
      if (h.speed < MOVE.STEAL_SLOW_SPEED) ps += MOVE.STEAL_SLOW_BONUS;
      if (rng.next() < ps * p.data.defense) {
        const dx = p.pos.x - h.pos.x, dz = p.pos.z - h.pos.z, l = Math.hypot(dx, dz) || 1;
        ball.launch({ x: dx / l * 2, y: 1.5, z: dz / l * 2 }, 'loose', { toucher: p });
        this.stat.steals++;
      } else p.stun(MOVE.STUN_STEAL_FAIL);
    }
  }

  run(seconds) { const n = Math.round(seconds / FIXED_DT); for (let i = 0; i < n; i++) this.step(); }
  runUntil(cond, maxSeconds) { const n = Math.round(maxSeconds / FIXED_DT); for (let i = 0; i < n; i++) { this.step(); if (cond()) return true; } return false; }
}

check('assignDefense: roster-index matching at CHECK, greedy nearest re-match on demand', () => {
  const s = new Sim(1);
  const w = s.world;
  const def = s.players.filter((p) => p.team !== w.offense);
  for (const d of def) { assert.ok(d.defAssign, 'assigned'); assert.equal(d.defAssign.index, d.index); assert.equal(d.defAssign.team, w.offense); }
  // Swap two attackers so the roster match is the far pairing; greedy picks the near one.
  const att = s.players.filter((p) => p.team === w.offense);
  const ax = att[1].pos.x, az = att[1].pos.z;
  att[1].pos.set(att[2].pos.x, 0, att[2].pos.z); att[2].pos.set(ax, 0, az);
  const onBall = assignDefense(w, true);
  assert.equal(def[1].defAssign, att[2]); assert.equal(def[2].defAssign, att[1]); assert.equal(def[0].defAssign, att[0]);
  assert.equal(onBall, def[0], 'returns the handler\'s defender');
  const seen = new Set(def.map((d) => d.defAssign)); assert.equal(seen.size, 3, 'one attacker each');
});

check('openness: defender in front counts, behind does not; laneBlocked; bestPassTarget prefers the open cutter', () => {
  const s = new Sim(2), w = s.world;
  const att = s.players.filter((p) => p.team === w.offense), def = s.players.filter((p) => p.team !== w.offense);
  const h = att[0];                                  // (0, -4.6), rim toward -z
  def[0].pos.set(0, 0, -5.9); assert.ok(Math.abs(openness(h, w) - 1.3) < 1e-6, 'front 1.3: ' + openness(h, w));
  for (const d of def) d.pos.set(d.pos.x, 0, -3.3);
  assert.equal(openness(h, w), 6, 'behind -> OPEN_MAX');
  def[1].pos.set(-2.7, 0, -6.1);                     // on the line handler -> leftWing (-5.4, -7.6)
  assert.equal(laneBlocked(h, att[1], w), true);
  def[1].pos.set(-2.7, 0, -9.0); assert.equal(laneBlocked(h, att[1], w), false);
  for (const d of def) d.pos.set(d.pos.x, 0, -13.5);  // everyone far away under the rim
  att[2].cutting = true;
  const out = { player: null, score: 0, lob: false };
  const best = bestPassTarget(h, w, out);
  assert.equal(best, att[2]); assert.ok(out.score > 1.2 * 6 - 1, 'score ' + out.score); assert.equal(out.lob, false);
  att[2].cutting = false;
});

check('pickSlot: teammates take distinct 3-pt slots away from the handler zone', () => {
  const s = new Sim(3), w = s.world;
  const att = s.players.filter((p) => p.team === w.offense);
  att[1].pos.set(-1, 0, -5.5); att[2].pos.set(1, 0, -5.5);
  att[1].slot = pickSlot(att[1], w); att[2].slot = pickSlot(att[2], w);
  assert.notEqual(att[1].slot, att[2].slot);
  assert.notEqual(att[1].slot, 0, 'top slot is inside the handler zone'); assert.notEqual(att[2].slot, 0);
  for (const i of [att[1].slot, att[2].slot]) assert.ok(dxz(SLOTS[i], att[0].pos) >= 2.5);
});

check('steerTo: direction, arrival easing, sprint gating', () => {
  const p = new Player({ team: TEAMS[0], teamIdx: 0, index: 0, data: TEAMS[0].players[0] });
  p.reset(0, -6, 0);
  let d = steerTo(p, 3, -6, true);
  assert.ok(Math.abs(d - 3) < 1e-9); assert.ok(Math.abs(p.intent.move.x - 1) < 1e-9 && Math.abs(p.intent.move.z) < 1e-9); assert.equal(p.intent.move.mag, 1); assert.equal(p.intent.sprint, true);
  d = steerTo(p, 0, -6.5, true);
  assert.ok(Math.abs(p.intent.move.mag - 0.5) < 1e-9, 'eases in'); assert.equal(p.intent.sprint, false, 'no sprint under 1 m');
  steerTo(p, 0.01, -6, false); assert.equal(p.intent.move.mag, 0, 'dead stop');
});

check('auto game, 60 s (seed 3, normal): shots, makes, passes, steals, no NaN, no long free balls, valid intents', () => {
  const s = new Sim(3);
  s.run(60);
  const st = s.stat;
  const fga = st.fga[0] + st.fga[1];
  assert.ok(fga >= 6, 'fga ' + fga);
  assert.ok(st.fgm[0] >= 1 && st.fgm[1] >= 1, 'fgm ' + st.fgm);
  assert.ok(st.passes >= 1, 'passes ' + st.passes);
  // CPU steal taps need the dribbler inside 1.0 m (spec 5.11); on normal (defGap 1.3 m) this harness's
  // simplified positioning rarely gets there, so the attempt check runs on hard (defGap 1.0 m).
  const hard = new Sim(3, { difficulty: 'hard' });
  hard.run(60);
  assert.ok(st.stealTries + hard.stat.stealTries >= 1, 'steal attempts normal ' + st.stealTries + ' hard ' + hard.stat.stealTries);
  assert.ok(st.maxFree <= 6, 'max free ball ' + st.maxFree);
  assert.ok(st.maxMove <= 1 + 1e-9, 'move magnitude ' + st.maxMove);
  assert.ok(st.holds.length >= 6);
  for (const f of st.holds) assert.ok(f >= 0.25 && f <= 1.25, 'hold f ' + f);
  const mean = st.holds.reduce((a, b) => a + b, 0) / st.holds.length;
  assert.ok(Math.abs(mean - 0.8) < 0.1, 'mean f ' + mean);
  assert.ok(st.contestJumps + st.rebJumps >= 1, 'jumps');
  console.log('    fga', st.fga, 'fgm', st.fgm, 'score', s.score, 'passes', st.passes, 'lobs', st.lobs, 'steals', st.steals + '/' + st.stealTries,
    'cross', st.crosses, 'blocks', st.blocks, 'contest', st.contestJumps, 'reb jumps', st.rebJumps, 'dead', JSON.stringify(st.deadReasons));
});

check('auto game, 60 s on easy and hard with other seeds: stable, and hard draws tighter release timing', () => {
  const easy = new Sim(11, { difficulty: 'easy' }); easy.run(60);
  const hard = new Sim(11, { difficulty: 'hard' }); hard.run(60);
  for (const s of [easy, hard]) {
    assert.ok(s.stat.fga[0] + s.stat.fga[1] >= 6, 'fga'); assert.ok(s.stat.maxFree <= 6, 'free ' + s.stat.maxFree);
  }
  const sd = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / a.length); };
  assert.ok(sd(hard.stat.holds) < sd(easy.stat.holds) + 0.05, 'hard sd ' + sd(hard.stat.holds) + ' easy sd ' + sd(easy.stat.holds));
});

check('contest: the on-ball defender jumps reactionDelay after his man starts a windup within 1.6 m', () => {
  const s = new Sim(4), w = s.world;
  s.run(CLOCK.CHECK + 0.05);
  assert.equal(w.state, 'LIVE');
  const h = s.ball.owner; const d = h.defAssign ? null : null;
  const def = s.players.find((p) => p.team !== w.offense && p.defAssign === h);
  def.pos.set(h.pos.x, 0, h.pos.z - 1.2); def.vel.set(0, 0, 0);
  h.ai.shooting = true; h.intent.primary.held = true; h.intent.primary.pressTs = w.time * 1000; h.ai.releaseAt = w.time + 0.44; h.ai.holdT = 0.44;
  h.startWindup('jumper');
  const t0 = w.time;
  const jumped = s.runUntil(() => def.isJumping, 1.0);
  assert.ok(jumped, 'defender jumped');
  const delay = w.time - t0;
  assert.ok(delay >= w.difficulty.reaction - 1e-6 && delay <= w.difficulty.reaction + 3 * FIXED_DT, 'delay ' + delay);
});

check('rebound: players near the rim run to the landing point of a loose ball and jump when it is within reach', () => {
  const s = new Sim(5), w = s.world;
  s.run(CLOCK.CHECK + 0.05);
  const ball = s.ball;
  for (const p of s.players) { p.hasBall = false; p.ballMode = null; }
  ball.owner = null; ball.state = 'loose'; ball.lastToucher = s.players[0];
  ball.pos.set(1.5, 3.6, -11.0); ball.vel.set(0, 0, 0); ball.rimContacts = 5; ball.rimEnabled = false;
  s.players[0].reset(-2, -11, 0); s.players[1].reset(3.5, -11, 0); s.players[3].reset(0, -9.5, 0);   // near the rim
  const near = s.players.filter((p) => dxz(p.pos, RIM) < 4.5);
  assert.ok(near.length >= 3);
  const before = near.map((p) => dxz(p.pos, ball.pos));
  updateAI(w, FIXED_DT);
  for (const p of near) { const m = p.intent.move; assert.ok(m.mag > 0.5, 'moving'); const dot = m.x * (ball.pos.x - p.pos.x) + m.z * (ball.pos.z - p.pos.z); assert.ok(dot > 0, 'toward the ball'); }
  const catcher = near[0];
  catcher.reset(1.6, -11.2, 0); ball.pos.set(1.5, 2.6, -11.0);
  updateAI(w, FIXED_DT);
  assert.equal(catcher.intent.primary.justPressed, true, 'jumps for a ball at 2.6 m within 1 m');
  ball.pos.set(1.5, 1.0, -11.0);
  updateAI(w, FIXED_DT);
  assert.equal(catcher.intent.primary.justPressed, false, 'no jump for a low ball');
  void before;
});

check('human-teammate rule: a CPU teammate on the user\'s team passes back to the user within 0.6 s', () => {
  const s = new Sim(6, { auto: false }), w = s.world;
  w.controlled = w.userPlayer; w.userPlayer.isUser = true;
  s.run(CLOCK.CHECK + 0.05);
  const mate = s.players[1];
  s.ball.attachTo(mate, 'held');
  const t0 = w.time;
  const passed = s.runUntil(() => s.ball.state === 'pass', 1.0);
  assert.ok(passed, 'pass launched');
  assert.ok(w.time - t0 <= 0.6 + 2 * FIXED_DT, 'within 0.6 s: ' + (w.time - t0));
  assert.equal(s.ball.passInfo.receiver, w.userPlayer);
  assert.equal(mate.passTarget, w.userPlayer);
  assert.equal(w.userPlayer.intent.move.mag, 0, 'the user\'s intent is never written by the AI');
});

check('urgency: shot clock under 3 s forces a shot, under 1 s the release beats the buzzer', () => {
  const s = new Sim(7), w = s.world;
  s.run(CLOCK.CHECK + 1.0);
  assert.ok(s.runUntil(() => s.ball.isHeld && w.state === 'LIVE', 5), 'a handler holds the ball');
  w.shotClock = 0.9;
  const h = s.ball.owner;
  const shot = s.runUntil(() => s.ball.state === 'flight', 1.0);
  assert.ok(shot, 'shot released');
  assert.ok(w.shotClock > 0, 'released before the buzzer: ' + w.shotClock);
  assert.equal(s.ball.shotInfo.shooter, h);
});

check('cut: an off-ball player whose guard is far cuts toward RIM - fwd*1.2 for 1.4 s, then returns to a slot', () => {
  const s = new Sim(12, { auto: false }), w = s.world;
  w.controlled = w.userPlayer; w.userPlayer.isUser = true;         // the human holds the ball
  s.run(CLOCK.CHECK + 0.3);
  const mate = s.players[1];
  const guard = s.players.find((p) => p.team !== mate.team && p.defAssign === mate);
  assert.ok(guard && mate.slot >= 0 && !mate.cutting);
  guard.reset(guard.pos.x, guard.pos.z + 3.5, 0);                 // far behind his man
  mate.ai.cutAt = w.time;
  assert.ok(s.runUntil(() => mate.cutting, 0.3), 'cut started');
  const fx = RIM.x - mate.pos.x, fz = RIM.z - mate.pos.z, fl = Math.hypot(fx, fz);
  const dot = mate.intent.move.x * fx / fl + mate.intent.move.z * fz / fl;
  assert.ok(dot > 0.9, 'runs at the rim: ' + dot);
  assert.ok(dxz({ x: mate.ai.cutX, z: mate.ai.cutZ }, RIM) - 1.2 < 1e-6, 'target 1.2 m short of the rim');
  const t0 = w.time;
  assert.ok(s.runUntil(() => !mate.cutting, 2.0), 'cut ended');
  assert.ok(Math.abs(w.time - t0 - 1.4) < 3 * FIXED_DT, 'cut lasted 1.4 s: ' + (w.time - t0));
  assert.ok(mate.slot >= 0, 'back to a slot');
});

check('CPU intents carry sim-time timestamps and one-step edges; inactive outside LIVE', () => {
  const s = new Sim(8), w = s.world;
  s.run(0.5);                                                  // still CHECK
  for (const p of s.players) { const it = p.intent; assert.equal(it.move.mag, 0); assert.equal(it.primary.held, false); assert.equal(it.sprint, false); }
  s.run(CLOCK.CHECK + 2.0);
  const h = s.ball.owner || s.ball.lastToucher;
  assert.ok(h.ai && h.ai.active);
  let sawPress = false, edgeOk = true;
  for (let i = 0; i < 600 && !sawPress; i++) {
    s.step();
    for (const p of s.players) {
      const b = p.intent.primary;
      if (b.justPressed) { sawPress = true; if (Math.abs(b.pressTs - w.time * 1000) > 1e-6) edgeOk = false; }
    }
  }
  assert.ok(sawPress, 'a press happened'); assert.ok(edgeOk, 'pressTs = world.time * 1000');
  s.step();
  for (const p of s.players) assert.ok(!(p.intent.primary.justPressed && p.intent.primary.justReleased && p.intent.primary.held), 'edge state consistent');
});

check('updateAI is allocation-free in steady state (needs --expose-gc; skipped otherwise)', () => {
  const s = new Sim(9), w = s.world;
  s.run(CLOCK.CHECK + 1.5);
  assert.equal(w.state, 'LIVE');
  const gc = globalThis.gc;
  if (!gc) { console.log('    (no gc exposed, skipped)'); return; }
  // Two measured windows after a long warm-up: JIT code objects land in the first window, so the
  // second one is the steady-state figure.
  for (let i = 0; i < 20000; i++) updateAI(w, FIXED_DT);
  gc();
  const before1 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 20000; i++) updateAI(w, FIXED_DT);
  gc();
  const delta1 = process.memoryUsage().heapUsed - before1;
  const before2 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 20000; i++) updateAI(w, FIXED_DT);
  gc();
  const delta2 = process.memoryUsage().heapUsed - before2;
  console.log('    heap delta over 20k calls: window 1 ' + delta1 + ' bytes, window 2 ' + delta2 + ' bytes');
  assert.ok(delta2 < 32 * 1024, 'steady-state heap grew by ' + delta2);
});

console.log(passed + ' checks passed');
