// Unit checks for the v2 AI (src/ai.js, src/ai-tend.js) and the test bot (src/testbot.js), spec §5.10 / §5.11 / §5.14.
// Runs on the real headless Game (proxy animators): matchups with the binding §5.10 values, resetAI countdowns, the
// catch gate, guardBeaten / laneClear, the pass-risk filter and riskTol, planCpuRelease, the R#29 no-back-off steer,
// the tendency helpers, a short auto game and the zero-allocation probe for updateAI (H10).
// Run: node test/unit-ai.mjs
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';
import { Game } from '../src/game.js';
import * as AI from '../src/ai.js';
import {
  tendOf, threeGateOK, onBallGap, riskTolOf, dietFactor, probeBand, closeGapOf, isMismatch, pokeProb, laneGambleP,
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
  // riskTol × riskTolMul (§2.5, §5.11)
  near(riskTolOf(h, DIFFICULTY.normal), tendOf(h).riskTol, 1e-12);
  near(riskTolOf(h, DIFFICULTY.easy), tendOf(h).riskTol * 1.6, 1e-12);
  near(riskTolOf(h, DIFFICULTY.hard), tendOf(h).riskTol * 0.7, 1e-12);
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

check('auto game (seed 2, q 60): every legend shoots, no NaN, intents carry sim-time stamps, Yao takes no non-urgent three', () => {
  const g = makeGame({ seed: 2, q: 60 });
  const shots = {};
  let yaoThrees = 0;
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

check('updateAI is allocation-free in steady state (H10)', () => {
  v8.setFlagsFromString('--expose_gc');
  const gc = vm.runInNewContext('gc');
  const g = makeGame({ seed: 12 });
  stepN(g, 60 * 20);
  const w = g.world;
  // warm every code path of the current state, then measure updateAI alone
  for (let i = 0; i < 600; i++) AI.updateAI(w, FIXED_DT);
  gc(); gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 20000; i++) AI.updateAI(w, FIXED_DT);
  const after = process.memoryUsage().heapUsed;
  gc(); gc();
  const kept = process.memoryUsage().heapUsed - before;
  // 20 000 calls: an allocation of even one small object per call would add ≥ 0.6 MB before the GC
  assert.ok(after - before < 256 * 1024, `heap grew ${after - before} B over 20 000 calls`);
  assert.ok(kept < 64 * 1024, `retained ${kept} B`);
  assert.ok(isThree(0, RIM.z + 8));
});

console.log(`\n${passed} checks passed`);
