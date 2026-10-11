// Unit checks for the v2 AI (src/ai.js, src/ai-tend.js) and the test bot (src/testbot.js), spec §5.10 / §5.11 / §5.14.
// Runs on the real headless Game (proxy animators): matchups with the binding §5.10 values, resetAI countdowns, the
// catch gate, guardBeaten / laneClear, the pass-risk filter and riskTol, planCpuRelease, the R#29 no-back-off steer,
// the tendency helpers, the I3b rotation / help-spot behaviour, short auto games and the updateAI memory guard (H10).
// Run: node test/unit-ai.mjs
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';
import { Game } from '../src/game.js';
import * as AI from '../src/ai.js';
import {
  tendOf, threeGateOK, onBallGap, riskTolOf, RISK_TOL_SCALE, RISK_TOL_CAP, dietFactor, probeBand, closeGapOf, isMismatch, pokeProb, laneGambleP,
  rotationDue,
} from '../src/ai-tend.js';
import { TestBot, BOT_MODES } from '../src/testbot.js';
import { matchupCost } from '../src/physics.js';
import { RIM, FIXED_DT, DIFFICULTY, SHOT_V2, isThree } from '../src/constants.js';

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('ok - ' + name); }
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} vs ${b} (±${eps})`);

function makeGame(o = {}) {
  const g = new Game({ scene: null, anim: 'proxy', seed: o.seed || 1, quarterSec: o.q || 120, auto: o.auto !== false,
    difficulty: o.difficulty || 'normal', ai: o.ai || AI });
  g.start({ auto: o.auto !== false, difficulty: o.difficulty || 'normal' });
  return g;
}
function stepN(g, n) { for (let i = 0; i < n; i++) g.step(FIXED_DT); }

// ------------------------------------------------------------------------------------------------ matchups

check('assignMatchups: binding §5.10 values (BRIGHT on DARK Σ 3.08, DARK on BRIGHT Σ 0.54), defAssign written', () => {
  const g = makeGame();
  const w = g.world;
  const dark = g.roster[0].map((p) => p.id), bright = g.roster[1].map((p) => p.id);
  assert.deepEqual([...dark].sort(), ['giannis', 'kyrie', 'lebron']);
  assert.deepEqual([...bright].sort(), ['jordan', 'kobe', 'yao']);
  const sum = (defTeam, offTeam) => {
    const att = g.roster[offTeam];
    let top = att[0];
    for (const a of att) if (a.legend.tend.checkShare > top.legend.tend.checkShare) top = a;
    let s = 0;
    for (const d of g.roster[defTeam]) s += matchupCost(d, d.defAssign, top);
    return s;
  };
  // BRIGHT defending DARK
  AI.assignMatchups(w, 0);
  const pairs1 = Object.fromEntries(g.roster[1].map((d) => [d.id, d.defAssign.id]));
  assert.deepEqual(pairs1, { jordan: 'kyrie', kobe: 'lebron', yao: 'giannis' });
  near(sum(1, 0), 3.08, 0.005, 'Σ BRIGHT on DARK');
  // DARK defending BRIGHT
  AI.assignMatchups(w, 1);
  const pairs0 = Object.fromEntries(g.roster[0].map((d) => [d.id, d.defAssign.id]));
  assert.deepEqual(pairs0, { lebron: 'kobe', kyrie: 'jordan', giannis: 'yao' });
  near(sum(0, 1), 0.54, 0.005, 'Σ DARK on BRIGHT');
  // the offence carries no assignment
  for (const a of g.roster[1]) assert.equal(a.defAssign, null);
});

// ------------------------------------------------------------------------------------------------ countdowns

check('resetAI: every countdown and plan back to its initial value; scores / gates objects kept (R#35)', () => {
  const g = makeGame();
  stepN(g, 60 * 20);
  const p = g.byId.kobe;
  const ai = p.ai;
  const scores = ai.scores, gates = ai.gates;
  for (const k of ['holdCd', 'setupCd', 'catchCd', 'passGateCd', 'stealCd', 'cutCd', 'helpCd', 'releaseCd', 'jumpCd', 'pokeCd', 'laneCd', 'closeCd', 'openCd']) ai[k] = 3.3;
  ai.releaseOn = true; ai.jumpOn = true; ai.pumpOn = true; ai.passTo = g.byId.jordan; ai.action = 'drive'; ai.bounces = 2;
  scores.shoot = 1.2; gates.catch = true;
  AI.resetAI(p);
  assert.equal(p.ai, ai, 'same state object (no reallocation of the per-player record)');
  assert.equal(ai.scores, scores); assert.equal(ai.gates, gates);
  for (const k of ['holdCd', 'setupCd', 'catchCd', 'passGateCd', 'stealCd', 'cutCd', 'helpCd', 'releaseCd', 'jumpCd', 'pokeCd', 'laneCd', 'closeCd', 'openCd']) assert.equal(ai[k], 0, k);
  assert.equal(ai.releaseOn, false); assert.equal(ai.jumpOn, false); assert.equal(ai.pumpOn, false);
  assert.equal(ai.passTo, null); assert.equal(ai.action, 'probe'); assert.equal(ai.bounces, 0);
  assert.equal(scores.shoot, 0); assert.equal(gates.catch, false);
  // aiDebug snapshot shape (`__game.ai(id)`)
  const dbg = AI.aiDebug(p);
  assert.deepEqual(Object.keys(dbg).sort(), ['action', 'gates', 'scores']);
});

check('countdowns: no absolute timestamps in the AI state (a rematch at a later world.time behaves like a fresh game)', () => {
  const g = makeGame({ seed: 3 });
  stepN(g, 60 * 30);
  for (const p of g.players) {
    for (const [k, v] of Object.entries(p.ai)) {
      if (typeof v !== 'number') continue;
      assert.ok(Math.abs(v) < 60, `${p.id}.ai.${k} = ${v} looks like a world-time stamp`);
    }
  }
});

// ------------------------------------------------------------------------------------------------ catch gate

check('catch gate: no CPU SHOOT press within 0.40 s of a catch (non-urgent), a press later when open', () => {
  const g = makeGame({ seed: 4 });
  const w = g.world;
  const h = g.byId.kobe;
  g.stageLive(h.team, h);
  g.teleport(h, 0, RIM.z + 4.5, Math.PI);            // open 15-footer, everyone else in the backcourt
  stepN(g, 1);
  h.ai.catchCd = 0.40; h.ai.setupCd = 0; h.ai.holdCd = 0;
  w.shotClock = 12;
  let firstPress = -1;
  const t0 = w.time;
  for (let i = 0; i < 90 && firstPress < 0; i++) {
    g.step(FIXED_DT);
    if (h.shot.active) firstPress = w.time - t0;
  }
  assert.ok(firstPress >= 0.40 - 1e-9, `pressed at ${firstPress}`);
  // urgent (shot clock ≤ 2 s): the gate is bypassed
  const g2 = makeGame({ seed: 5 });
  const h2 = g2.byId.jordan;
  g2.stageLive(h2.team, h2);
  g2.teleport(h2, 0, RIM.z + 4.5, Math.PI);
  stepN(g2, 1);
  h2.ai.catchCd = 0.40; h2.ai.setupCd = 0; h2.ai.holdCd = 0;
  g2.world.shotClock = 1.5;
  let pressed2 = -1;
  const t2 = g2.world.time;
  for (let i = 0; i < 40 && pressed2 < 0; i++) { g2.step(FIXED_DT); if (h2.shot.active) pressed2 = g2.world.time - t2; }
  assert.ok(pressed2 >= 0 && pressed2 < 0.40, `urgent press at ${pressed2}`);
});

// ------------------------------------------------------------------------------------------------ drive geometry

check('guardBeaten (R#26): null / behind / > 0.90 m off the line → beaten; in front on the line → not', () => {
  const g = makeGame();
  const h = g.byId.lebron, d = g.byId.kobe;
  g.stageLive(h.team, h);
  g.teleport(h, 0, RIM.z + 6, Math.PI);
  assert.equal(AI.guardBeaten(h, null), true);
  g.teleport(d, 0, RIM.z + 5, 0);                   // 1 m in front, on the line
  assert.equal(AI.guardBeaten(h, d), false);
  g.teleport(d, 0.85, RIM.z + 5, 0);                // 0.85 m lateral
  assert.equal(AI.guardBeaten(h, d), false);
  g.teleport(d, 0.95, RIM.z + 5, 0);                // 0.95 m lateral
  assert.equal(AI.guardBeaten(h, d), true);
  g.teleport(d, 0, RIM.z + 6.5, 0);                 // behind
  assert.equal(AI.guardBeaten(h, d), true);
});

check('laneClear: another defender within 0.90 m of the next 3 m of the handler→rim segment blocks the lane', () => {
  const g = makeGame();
  const h = g.byId.lebron, gd = g.byId.kobe, help = g.byId.yao;
  g.stageLive(h.team, h);
  g.teleport(h, 0, RIM.z + 7, Math.PI);
  g.teleport(gd, 0, RIM.z + 6, 0);
  g.teleport(help, 0.5, RIM.z + 5, 0);              // 0.5 m off the lane, 2 m ahead
  assert.equal(AI.laneClear(h, gd, g.world), false);
  g.teleport(help, 2.0, RIM.z + 5, 0);
  assert.equal(AI.laneClear(h, gd, g.world), true);
  g.teleport(help, 0.3, RIM.z + 1.5, 0);            // in the lane but beyond the next 3 m
  assert.equal(AI.laneClear(h, gd, g.world), true);
});

// ------------------------------------------------------------------------------------------------ pass risk

check('passRisk: grows as a defender nears the line; 0 with nobody around; bestPassTarget respects riskTol', () => {
  const g = makeGame({ seed: 6 });
  const w = g.world;
  const h = g.byId.lebron, r = g.byId.kyrie, d = g.byId.kobe;
  g.stageLive(h.team, h);
  g.teleport(h, -3, -7, Math.PI / 2); g.teleport(r, 3, -7, -Math.PI / 2);
  for (const q of g.players) if (q !== h && q !== r) g.teleport(q, q.team === h.team ? -6.5 : 6.5, -1.5, 0);
  const r0 = AI.passRisk(h, r, r.pos.x, r.pos.z, w);
  assert.ok(r0 < 1e-9, `open lane risk ${r0}`);
  const risks = [2.5, 1.5, 0.8, 0.3].map((off) => { g.teleport(d, 0, -7 + off, 0); return AI.passRisk(h, r, r.pos.x, r.pos.z, w); });
  for (let i = 1; i < risks.length; i++) assert.ok(risks[i] >= risks[i - 1] - 1e-9, `monotone ${risks}`);
  assert.ok(risks[3] > riskTolOf(h, DIFFICULTY.normal), 'a defender 0.3 m off the line is over LeBron\'s tolerance');
  // the filter: a defender on the line → no target; moved away → the target comes back
  g.teleport(d, 0, -7 + 0.3, 0);
  assert.notEqual(AI.bestPassTarget(h, w), r, 'Kyrie (lane blocked) is never the target');
  g.teleport(d, 6.5, -1.5, 0);
  const out = { player: null, score: 0, risk: 0, ep: 0, lob: false, x: 0, z: 0 };
  const got = AI.bestPassTarget(h, w, out);
  assert.ok(got && got.team === h.team && got !== h, 'a teammate is available again');
  assert.ok(AI.passRisk(h, r, r.pos.x, r.pos.z, w) <= riskTolOf(h, DIFFICULTY.normal), 'Kyrie\'s lane is safe again');
  assert.ok(out.risk <= riskTolOf(h, DIFFICULTY.normal) + 1e-12);
  assert.ok(Number.isFinite(out.ep) && out.ep > 0);
  // riskTol × riskTolMul (§2.5, §5.11) on the calibrated risk scale (I3: × RISK_TOL_SCALE)
  near(riskTolOf(h, DIFFICULTY.normal), Math.min(RISK_TOL_CAP, tendOf(h).riskTol * RISK_TOL_SCALE), 1e-12);
  near(riskTolOf(h, DIFFICULTY.easy), Math.min(RISK_TOL_CAP, tendOf(h).riskTol * 1.6 * RISK_TOL_SCALE), 1e-12);
  near(riskTolOf(h, DIFFICULTY.hard), Math.min(RISK_TOL_CAP, tendOf(h).riskTol * 0.7 * RISK_TOL_SCALE), 1e-12);
});

check('bestPassTarget over random live states: the chosen pass is never above the passer\'s riskTol', () => {
  const g = makeGame({ seed: 7 });
  const w = g.world;
  const out = { player: null, score: 0, risk: 0, ep: 0, lob: false, x: 0, z: 0 };
  let n = 0;
  for (let k = 0; k < 60 * 120; k++) {
    g.step(FIXED_DT);
    const h = w.ball.owner;
    if (!h || w.state !== 'LIVE' || k % 5) continue;
    if (AI.bestPassTarget(h, w, out)) { n++; assert.ok(out.risk <= riskTolOf(h, DIFFICULTY.normal) + 1e-9, `${h.id} risk ${out.risk}`); }
  }
  assert.ok(n > 0, 'some passes were available');
});

// ------------------------------------------------------------------------------------------------ release plan

check('planCpuRelease: hold = tIdeal + eT_cpu, eT_cpu ∈ [−0.25, +0.22] (§5.3.2); the release fires at the plan', () => {
  const g = makeGame({ seed: 8 });
  const w = g.world;
  const h = g.byId.kobe;
  let seen = 0;
  for (let k = 0; k < 40; k++) {
    g.stageLive(h.team, h);
    g.teleport(h, 0, RIM.z + 5, Math.PI);
    stepN(g, 1);
    h.ai.catchCd = 0; h.ai.setupCd = 0; h.ai.holdCd = 0; w.shotClock = 12;
    let t = 0;
    while (!h.shot.active && t < 120) { g.step(FIXED_DT); t++; }
    if (!h.shot.active || h.ai.pumpOn) continue;
    const e = h.ai.holdT - h.shot.tIdeal;
    assert.ok(e >= SHOT_V2.CPU_ET_MIN - 1e-9 && e <= SHOT_V2.CPU_ET_MAX + 1e-9, `eT ${e}`);
    const press = h.intent.primary.pressTs;
    while (h.intent.primary.held && t < 240) { g.step(FIXED_DT); t++; }
    const held = (h.intent.primary.releaseTs - press) / 1000;
    near(held, h.ai.holdT, 1e-6, 'released at the planned hold');
    seen++;
  }
  assert.ok(seen >= 10, `planned releases seen ${seen}`);
});

// ------------------------------------------------------------------------------------------------ shot steering (R#29)

check('no back-off (R#29): during the man\'s shot the on-ball defender never steers away from the shooter', () => {
  const g = makeGame({ seed: 9, auto: false, difficulty: 'normal' });
  const sh = g.byId.lebron, d = g.byId.kobe;
  let checked = 0;
  for (let k = 0; k < 20; k++) {
    g.stageLive(sh.team, sh);
    g.teleport(sh, 0, RIM.z + 5.5, Math.PI);
    g.teleport(d, 0, RIM.z + 5.5 - 0.91, 0);
    d.defAssign = sh;
    g.debugShoot({ shooter: sh.id, kind: 'jumper', eT: 0 });
    for (let i = 0; i < 30 && sh.shot.active && !sh.shot.launched; i++) {
      g.step(FIXED_DT);
      const m = d.intent.move;
      const ux = sh.pos.x - d.pos.x, uz = sh.pos.z - d.pos.z, l = Math.hypot(ux, uz) || 1;
      if (d.state !== 'jump') { assert.ok((m.x * ux + m.z * uz) / l >= -1e-9, 'stick component away from the shooter'); checked++; }
    }
  }
  assert.ok(checked > 20, `steps checked ${checked}`);
});

// ------------------------------------------------------------------------------------------------ tendencies

check('tendency helpers: three gates, Yao drop, closeout gap, mismatch, poke / lane gamble, diet factor bounds', () => {
  const g = makeGame();
  const w = g.world;
  const yao = g.byId.yao, gi = g.byId.giannis, ky = g.byId.kyrie, lb = g.byId.lebron, kb = g.byId.kobe, mj = g.byId.jordan;
  assert.equal(threeGateOK(yao, 6, 10), false); assert.equal(threeGateOK(yao, 6, 1.4), true);
  assert.equal(threeGateOK(gi, 2.4, 10), false); assert.equal(threeGateOK(gi, 2.5, 10), true);
  assert.equal(threeGateOK(ky, 0.5, 10), true);
  // Yao guarding the ball beyond 6.5 m drops at least 1.8 m (and to the paint)
  g.stageLive(gi.team, gi);
  g.teleport(gi, 0, RIM.z + 8, Math.PI);
  assert.ok(onBallGap(yao, gi, DIFFICULTY.normal.defGap) >= 3.5 - 1e-9);
  g.teleport(gi, 0, RIM.z + 5, Math.PI);
  assert.ok(onBallGap(yao, gi, DIFFICULTY.normal.defGap) < 1.8);
  assert.equal(closeGapOf(yao), 1.5); assert.equal(closeGapOf(kb), 1.0);
  assert.equal(isMismatch(lb, kb), true); assert.equal(isMismatch(ky, yao), false);
  for (const p of g.players) { assert.ok(pokeProb(p) <= 0.95 + 1e-12); assert.ok(laneGambleP(p, DIFFICULTY.hard) <= 1); }
  assert.ok(pokeProb(mj) > pokeProb(yao));
  for (const p of g.players) for (const z of ['rim', 'close', 'mid', 'three']) {
    const f = dietFactor(p, w, z);
    assert.ok(f >= 0.4 - 1e-12 && f <= 2.5 + 1e-12, `${p.id} ${z} ${f}`);
  }
  const bandYao = probeBand(yao, true), bandKy = probeBand(ky, true);
  assert.ok(bandYao[1] <= 6.0, 'Yao probes in the post band'); assert.ok(bandKy[0] >= 6.0, 'Kyrie probes at the arc');
});

// ------------------------------------------------------------------------------------------------ whole games

// ------------------------------------------------------------------------------------------------ I3 behaviours

check('pass risk (I3): a hawk a step short of the lane, the receiver\'s own closeout and a guard whose stun ends in flight all count', () => {
  const g = makeGame({ seed: 12 });
  const w = g.world;
  const lb = g.byId.lebron, ky = g.byId.kyrie, gi = g.byId.giannis, mj = g.byId.jordan, kb = g.byId.kobe, yao = g.byId.yao;
  g.stageLive(lb.team, lb);
  // the check formation the avg bot used to throw into: Jordan (hawk, Kyrie's man) 0.14 m outside his intercept radius
  g.teleport(lb, 0, -4.6, Math.PI); g.teleport(ky, 6.0, -6.5, Math.PI); g.teleport(gi, 2.7, -12.5, Math.PI);
  g.teleport(mj, 4.6, -7.1, 0); g.teleport(kb, 0, -6.0, 0); g.teleport(yao, 1.0, -11.3, 0);
  mj.defAssign = ky; kb.defAssign = lb; yao.defAssign = gi;
  assert.ok(AI.passRisk(lb, ky, ky.pos.x, ky.pos.z, w) > riskTolOf(lb, DIFFICULTY.normal), 'Jordan\'s lane is not safe');
  // a stunned guard in the lane: counted when his stun runs out before the ball passes him, not when it lasts
  g.teleport(mj, 6.8, -1.0, 0); g.teleport(kb, 2.0, -5.4, 0);
  const free = AI.passRisk(lb, ky, ky.pos.x, ky.pos.z, w);
  kb.stun(0.05);
  near(AI.passRisk(lb, ky, ky.pos.x, ky.pos.z, w), free, 1e-9, 'short stun = in play');
  kb.stun(2.0);
  assert.ok(AI.passRisk(lb, ky, ky.pos.x, ky.pos.z, w) < free, 'a long stun takes him out');
});

check('giannis.longDunk (I3): with an empty runway the AI sprints into the long gather; with Yao in the lane it does not', () => {
  for (let seed = 1; seed <= 4; seed++) {
    for (const blocked of [false, true]) {
      const g = makeGame({ seed });
      const gi = g.byId.giannis, yao = g.byId.yao;
      g.stageLive(gi.team, gi);
      g.teleport(gi, 0, RIM.z + 10.5, Math.PI);
      for (const q of g.players) if (q !== gi) g.teleport(q, q.team === gi.team ? (q.id === 'lebron' ? -6.5 : 6.5) : (q.id === 'yao' ? -6.8 : 6.8), -1.0, 0);
      if (blocked) g.teleport(yao, 0.4, RIM.z + 4.2, 0);
      let kind = '';
      for (let t = 0; t < 300 && !kind; t++) {
        g.step(FIXED_DT);
        if (t === 0) { gi.ai.catchCd = 0; gi.ai.setupCd = 0; gi.ai.holdCd = 0; g.world.shotClock = 12; }
        if (blocked) { g.teleport(yao, 0.4, RIM.z + 4.2, 0); }
        if (gi.shot.active) kind = gi.shot.kind + '/' + gi.shot.variant;
      }
      if (blocked) assert.notEqual(kind, 'dunk/longGather', `seed ${seed}: no long gather through Yao`);
      else assert.equal(kind, 'dunk/longGather', `seed ${seed}: open runway → long gather (got ${kind})`);
    }
  }
});

check('fadeaway (I3): holding + stick away + SHOOT resolves to a fade (no dribble first); Kobe and Jordan take fades in auto games', () => {
  const g = makeGame({ seed: 13, auto: false });
  const bot = new TestBot(g, { seed: 13 }); bot.set('off'); g.input = bot;
  const lb = g.byId.lebron;
  g.stageLive(lb.team, lb);
  g.setControlled(lb);
  g.teleport(lb, 0, RIM.z + 5.2, Math.PI);
  for (const q of g.players) if (q.team !== lb.team) g.teleport(q, q.id === 'kobe' ? 0 : 6.8, q.id === 'kobe' ? RIM.z + 4.2 : -1.0, 0);
  stepN(g, 30);                                         // past the catch hold (0.35 s), ball still in the hands
  assert.ok(lb.holding, 'holding before the press');
  const it = bot.intent, ms = (g.world.time + FIXED_DT) * 1000;
  it.move.x = 0; it.move.z = 1; it.move.mag = 1;       // away from the rim (+z)
  it.primary.held = true; it.primary.justPressed = true; it.primary.pressTs = ms; it.primary.heldTime = 0;
  g.step(FIXED_DT);
  assert.equal(lb.shot.kind, 'fade', `kind ${lb.shot.kind}`);
  let fades = 0;
  for (const seed of [1, 2, 3]) {
    const a = makeGame({ seed, q: 60 });
    a.on('shot', (e) => { if ((e.playerId === 'kobe' || e.playerId === 'jordan') && e.kind === 'fade') fades++; });
    let n = 0; while (a.state !== 'GAME_OVER' && n < 60 * 60 * 25) { a.step(FIXED_DT); n++; }
  }
  assert.ok(fades >= 3, `Kobe / Jordan fades ${fades}`);
});

check('switch on the help (I3): rotations change matchups mid-possession; Yao never switches', () => {
  let switches = 0, yaoMoved = 0;
  for (const seed of [4, 5]) {
    const g = makeGame({ seed, q: 60 });
    let off = -1, start = null;
    let n = 0;
    while (g.state !== 'GAME_OVER' && n < 60 * 60 * 25) {
      g.step(FIXED_DT); n++;
      const w = g.world;
      if (w.state !== 'LIVE') { off = -1; continue; }
      const defs = g.roster[1 - w.offense];
      if (off !== w.offense || !start) { off = w.offense; start = new Map(defs.map((d) => [d, d.defAssign])); continue; }
      for (const d of defs) if (d.defAssign !== start.get(d)) {
        switches++;
        if (d.id === 'yao' && d.defAssign && isThree(d.defAssign.pos.x, d.defAssign.pos.z)) yaoMoved++;
        start.set(d, d.defAssign);
      }
    }
  }
  assert.ok(switches > 0, 'some help rotations switched');
  assert.equal(yaoMoved, 0, 'Yao never switched onto a perimeter player');
});

check('rotation (I3b): a standing human\'s open man draws the nearest CPU helper; never for an active human or a CPU guard', () => {
  const g = makeGame({ seed: 3, auto: false });
  const bot = new TestBot(g, { seed: 3 }); bot.set('off'); g.input = bot;
  const kobe = g.byId.kobe, lb = g.byId.lebron, ky = g.byId.kyrie, gi = g.byId.giannis;
  g.stageLive(kobe.team, kobe);
  AI.assignMatchups(g.world, kobe.team);
  assert.equal(lb.defAssign, kobe, 'LeBron guards Kobe');
  g.setControlled(lb);
  const place = () => {
    g.teleport(kobe, 1.0, RIM.z + 5.6, Math.PI);       // a midrange look
    g.teleport(lb, 1.6, RIM.z + 8.4, 0);               // the human 2.9 m behind him, stick idle
    g.teleport(g.byId.jordan, -5.5, RIM.z + 4.0, 0); g.teleport(ky, -4.6, RIM.z + 4.6, 0);
    g.teleport(g.byId.yao, 3.0, RIM.z + 1.2, 0); g.teleport(gi, 2.4, RIM.z + 2.0, 0);
  };
  place();
  const it = bot.intent;
  it.move.x = 0; it.move.z = 0; it.move.mag = 0;
  assert.equal(rotationDue(gi, kobe, g.world), true, 'Giannis (nearest) is due');
  assert.equal(rotationDue(ky, kobe, g.world), false, 'Kyrie is not the nearest');
  const li = lb.intent.move;                            // the human's stick as the game copied it onto LeBron
  li.x = 0; li.z = -1; li.mag = 1;                       // the human works back: no rotation
  assert.equal(rotationDue(gi, kobe, g.world), false, 'active human');
  li.x = 0; li.z = 0; li.mag = 0;
  // integrated: Giannis closes out (rotCd set) and ends up in front of Kobe within ~1.6 m
  let rotated = false;
  for (let t = 0; t < 45; t++) {
    kobe.ai.catchCd = 9; kobe.ai.setupCd = 9;           // keep the handler still (gates) while the helper rotates
    g.step(FIXED_DT);
    if (gi.ai.rotCd > 0) rotated = true;
  }
  assert.ok(rotated, 'Giannis rotated');
  const dx = gi.pos.x - kobe.pos.x, dz = gi.pos.z - kobe.pos.z, d = Math.hypot(dx, dz);
  assert.ok(d < 1.6 && dz < 0, `Giannis ${d.toFixed(2)} m from Kobe, rim side (dz ${dz.toFixed(2)})`);
  // a CPU guard far from his man is never covered for (auto game: nobody is user-controlled)
  const a = makeGame({ seed: 3 });
  const k2 = a.byId.kobe;
  a.stageLive(k2.team, k2); AI.assignMatchups(a.world, k2.team);
  a.teleport(k2, 1.0, RIM.z + 5.6, Math.PI); a.teleport(a.byId.lebron, 1.6, RIM.z + 8.4, 0);
  a.teleport(a.byId.giannis, 2.4, RIM.z + 2.0, 0); a.teleport(a.byId.kyrie, -4.6, RIM.z + 4.6, 0);
  assert.equal(rotationDue(a.byId.giannis, k2, a.world), false, 'CPU guard');
});

check('help spot (I3b): helpers stay under the rim against a LeBron power drive (no bump-stunned helper, no free dunk)', () => {
  let dunksAfterHelperStun = 0, helperStuns = 0;
  for (const seed of [1, 2]) {
    const g = new Game({ scene: null, anim: 'proxy', seed, quarterSec: 60, auto: false, difficulty: 'hard', ai: AI });
    const bot = new TestBot(g, { seed }); bot.set('avg'); g.input = bot;
    g.start({ auto: false, difficulty: 'hard' });
    let stunT = -9;
    g.on('bump', (e) => {
      const d = g.byId[e.defenderId], lb = g.byId.lebron;
      if (!d || e.playerId !== 'lebron' || d.defAssign === lb) return;
      if (d.state === 'stunned') { helperStuns++; stunT = g.world.time; }
    });
    g.on('shot', (e) => { if (e.playerId === 'lebron' && e.kind === 'dunk' && g.world.time - stunT < 1.0) dunksAfterHelperStun++; });
    let n = 0;
    while (g.state !== 'GAME_OVER' && n < 60 * 60 * 12) { bot.step(FIXED_DT); g.step(FIXED_DT); n++; }
  }
  assert.ok(dunksAfterHelperStun <= 1, `LeBron dunks right after running over a helper: ${dunksAfterHelperStun} (helper stuns ${helperStuns})`);
});

check('auto games (seeds 2, 3, q 60): every legend shoots, no NaN, intents carry sim-time stamps, Yao takes no non-urgent three', () => {
  // two short games pooled: a third option (Giannis, checkShare 0.10) can go a 4 × 60 s game without a shot
  const shots = {};
  let yaoThrees = 0;
  for (const seed of [2, 3]) {
    const g = makeGame({ seed, q: 60 });
    g.on('shot', (e) => { shots[e.playerId] = (shots[e.playerId] || 0) + 1; if (e.playerId === 'yao' && e.points === 3 && g.world.shotClock >= 1.5) yaoThrees++; });
    let steps = 0;
    while (g.state !== 'GAME_OVER' && steps < 60 * 60 * 20) {
      g.step(FIXED_DT); steps++;
      for (const p of g.players) {
        assert.ok(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.z), 'finite positions');
        const it = p.intent;
        assert.ok(Number.isFinite(it.move.x) && Math.hypot(it.move.x, it.move.z) <= 1 + 1e-6, 'stick within the unit disc');
        if (it.primary.justPressed) assert.ok(Math.abs(it.primary.pressTs - g.world.time * 1000) <= 2 * FIXED_DT * 1000 + 1e-6, 'press timestamp in sim time');
      }
    }
    assert.equal(g.state, 'GAME_OVER');
  }
  for (const id of ['lebron', 'kyrie', 'giannis', 'jordan', 'kobe', 'yao']) assert.ok(shots[id] > 0, `${id} shot`);
  assert.equal(yaoThrees, 0);
});

check('test bot: modes, deterministic per seed, drives the real Intent (both teams shoot)', () => {
  assert.deepEqual([...BOT_MODES], ['off', 'idle', 'avg', 'good', 'drive', 'pullup']);
  const run = () => {
    const g = new Game({ scene: null, anim: 'proxy', seed: 11, quarterSec: 60, auto: false, difficulty: 'normal', ai: AI });
    const bot = new TestBot(g, { seed: 11 }); bot.set('avg'); g.input = bot;
    g.start({ auto: false, difficulty: 'normal' });
    let s = 0;
    while (g.state !== 'GAME_OVER' && s < 60 * 60 * 10) { bot.step(FIXED_DT); g.step(FIXED_DT); s++; }
    return g.metrics.snapshot().team.map((t) => [t.fga, t.fgm]);
  };
  const a = run(), b = run();
  assert.deepEqual(a, b, 'same seed → same game');
  assert.ok(a[0][0] > 0 && a[1][0] > 0, 'both teams shot');
});

check('updateAI memory over live states (H10 guard): no retained growth, per-call garbage within the measured baseline', () => {
  // I3b: the old probe sampled one state at 20 s that happened to be CHECK (no AI work), so it passed by luck. Measured
  // over 12 LIVE states the AI step leaves ≈ 0.9–1.8 KB of short-lived garbage per call (pre-I3b code: 1.5 KB) —
  // doubles boxed at call sites TurboFan did not inline (distXZ: 80 B = four arguments + the result), no retained
  // objects. This guards against regressions (a per-call object or array would add far more) and leaks; the boxing
  // itself is an open issue (WP5 / H10 refactor: pass {x, z} records instead of double arguments in hot helpers).
  v8.setFlagsFromString('--expose_gc');
  const gc = vm.runInNewContext('gc');
  let sum = 0, n = 0, keptMax = 0;
  for (const seed of [12, 3, 5]) {
    const g = makeGame({ seed });
    for (const t of [15, 31, 47, 63]) {
      while (g.world.time < t || g.state !== 'LIVE') g.step(FIXED_DT);
      const w = g.world;
      for (let i = 0; i < 600; i++) AI.updateAI(w, FIXED_DT);
      gc(); gc();
      const before = process.memoryUsage().heapUsed;
      for (let i = 0; i < 4000; i++) AI.updateAI(w, FIXED_DT);
      sum += (process.memoryUsage().heapUsed - before) / 4000; n++;
      gc(); gc();
      keptMax = Math.max(keptMax, process.memoryUsage().heapUsed - before);
    }
  }
  const mean = sum / n;
  console.log(`   updateAI: ${Math.round(mean)} B/call mean over ${n} LIVE states, max retained ${Math.round(keptMax / 1024)} KB`);
  assert.ok(mean < 2600, `mean garbage ${Math.round(mean)} B per updateAI call`);
  assert.ok(keptMax < 64 * 1024, `retained ${keptMax} B`);
  assert.ok(isThree(0, RIM.z + 8));
});


console.log(`\n${passed} checks passed`);
