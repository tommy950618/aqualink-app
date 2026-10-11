#!/usr/bin/env node
/**
 * Headless balance harness (spec §5.14, GP §11.3–§11.5): bands A (CPU vs CPU), B (idle human), C (average human bot)
 * and the deterministic scenarios S1–S11, run on the real Game with proxy animators and the v2 AI (src/ai.js) and
 * test bot (src/testbot.js). Prints every metric with its band and exits 1 when any assertion fails.
 *
 *   node test/balance.mjs                    bands A, B, C + scenarios S1–S11 (q = 120, seeds per §5.14)
 *   node test/balance.mjs --quick            CI smoke: seeds 1–3, q = 60, bands A widened by ±5 points
 *   node test/balance.mjs --bands=A,B        only these bands (no scenarios unless --scenarios)
 *   node test/balance.mjs --scenarios        only the scenarios (all, or --scenarios=S1,S3,S6)
 *   node test/balance.mjs --verbose          per-game lines and per-legend tables
 *   node test/balance.mjs --seeds=11-40      band A over other seeds (tuning: the mean behind the spec's seeds 1–10)
 */
import { Game } from '../src/game.js';
import * as AI from '../src/ai.js';
import { TestBot } from '../src/testbot.js';
import { RIM, CLOCK, FIXED_DT, DIFFICULTY, isThree } from '../src/constants.js';
import { LEGENDS } from '../src/legends.js';
import { ABILITY_IDS } from '../src/abilities.js';
import { n } from '../src/ratings.js';
import { onBallGap, riskTolOf, profileMix } from '../src/ai-tend.js';
import { pressButton, releaseButton, clearEdges } from '../src/input.js';
import { resolveShot } from '../src/context.js';

// ------------------------------------------------------------------------------------------------ CLI
const ARGS = process.argv.slice(2);
const flag = (name) => ARGS.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const flagList = (name) => { const a = ARGS.find((x) => x.startsWith(`--${name}=`)); return a ? a.split('=')[1].split(',').map((s) => s.trim().toUpperCase()) : null; };
const QUICK = flag('quick');
const VERBOSE = flag('verbose');
const WANT_SCEN = flag('scenarios');
const WANT_BANDS = flag('bands');
const BANDS = flagList('bands') || (WANT_SCEN && !WANT_BANDS ? [] : ['A', 'B', 'C']);
const SCENARIOS = flagList('scenarios') || (WANT_BANDS && !WANT_SCEN ? [] : ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11']);
const Q = QUICK ? 60 : 120;
const SEED_RANGE = (() => { const a = ARGS.find((x) => x.startsWith('--seeds=')); if (!a) return null; const [lo, hi] = a.split('=')[1].split('-').map(Number); return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i); })();
const SEEDS_A = SEED_RANGE || (QUICK ? [1, 2, 3] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const SEEDS_BC = QUICK ? [1, 2, 3] : [1, 2, 3, 4, 5];
const SEEDS_WIN = QUICK ? [1, 2, 3, 4, 5, 6] : Array.from({ length: 15 }, (_, i) => i + 1);
const WIDEN = QUICK ? 0.05 : 0;
const MAX_STEPS = 60 * 60 * 45;

// ------------------------------------------------------------------------------------------------ reporting
let failures = 0, checks = 0;
const pct = (v) => (Number.isFinite(v) ? (100 * v).toFixed(1) + ' %' : 'n/a');
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : 'n/a');
function check(name, value, ok, band) {
  checks++;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(58)} ${String(value).padEnd(26)} ${band || ''}`);
  return ok;
}
const inBand = (v, lo, hi) => Number.isFinite(v) && v >= lo - 1e-9 && v <= hi + 1e-9;
const ratio = (a, b) => (b > 0 ? a / b : NaN);
function section(t) { console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 100 - t.length))}`); }

// ------------------------------------------------------------------------------------------------ game runner

/**
 * One full game: { seed, q, auto, difficulty, bot ('idle'|'avg'|...|null) } → { g, m, extra }.
 * extra: invariant violations, Giannis non-urgent threes and their openness, CPU poke attempts.
 */
function runGame(o) {
  const g = new Game({ scene: null, anim: 'proxy', seed: o.seed, quarterSec: o.q, auto: !!o.auto, difficulty: o.difficulty || 'normal', ai: AI });
  let bot = null;
  if (o.bot) { bot = new TestBot(g, { seed: o.seed }); bot.set(o.bot); g.input = bot; }
  const extra = { invariants: 0, giannisThrees: 0, giannisThreesClosed: 0, pokes: 0 };
  g.on('shot', (e) => {
    if (e.playerId === 'giannis' && e.points === 3 && g.world.shotClock >= 3) {
      extra.giannisThrees++;
      if (AI.openness(g.byId.giannis, g.world) < 2.5) extra.giannisThreesClosed++;
    }
  });
  const orig = g.startPoke;
  g.startPoke = function (p, human) { const r = orig.call(this, p, human); if (r && !human) extra.pokes++; return r; };
  g.start({ auto: !!o.auto, difficulty: o.difficulty || 'normal' });
  let steps = 0;
  while (g.state !== 'GAME_OVER' && steps < MAX_STEPS) {
    if (bot) bot.step(FIXED_DT);
    g.step(FIXED_DT);
    steps++;
    const w = g.world, b = g.ball;
    for (let i = 0; i < 6; i++) { const p = g.players[i]; if (!Number.isFinite(p.pos.x + p.pos.z + p.vel.x + p.vel.z + p.jumpY)) extra.invariants++; }
    if (!Number.isFinite(b.pos.x + b.pos.y + b.pos.z) || b.pos.y < 0.10 - 1e-9) extra.invariants++;
    if (!(w.shotClock >= 0 && w.shotClock <= CLOCK.SHOT)) extra.invariants++;
  }
  if (g.state !== 'GAME_OVER') extra.invariants++;
  extra.invariants += g.debug.invariantsBroken;
  extra.steps = steps;
  return { g, m: g.metrics.snapshot(), extra };
}

/** Pooled team / player aggregates over several games of the same lineup. */
function aggregate(runs) {
  const T = [0, 1].map(() => ({
    fga: 0, fgm: 0, pa3: 0, rim: 0, close: 0, mid: 0, three: 0, drivesFinished: 0, blk: 0, stl: 0, tov: 0, shotClock: 0, pts: 0,
    passes: 0, intdef: 0, ankles: 0, airballs: 0, airballOOB: 0, untouched: 0, untouchedOOB: 0, poss: 0, liveSec: 0, wins: 0,
  }));
  const P = {};
  const abilities = {};
  let invariants = 0, giannisThrees = 0, giannisClosed = 0;
  const ctp = [], rel = [], shots = [];
  for (const r of runs) {
    const m = r.m;
    invariants += r.extra.invariants; giannisThrees += r.extra.giannisThrees; giannisClosed += r.extra.giannisThreesClosed;
    for (let t = 0; t < 2; t++) {
      const S = m.team[t], A = T[t];
      A.fga += S.fga; A.fgm += S.fgm; A.pa3 += S.pa3; A.rim += S.zone.rim.a; A.close += S.zone.close.a; A.mid += S.zone.mid.a; A.three += S.zone.three.a;
      A.drivesFinished += S.drivesFinished; A.blk += S.blk; A.stl += S.stl; A.pts += S.pts; A.passes += S.passes; A.intdef += S.intercepts + S.deflects;
      A.tov += S.tov.steal + S.tov.intercept + S.tov.oob + S.tov.shotClock + S.tov.notCleared; A.shotClock += S.tov.shotClock;
      A.ankles += S.ankles; A.airballs += S.airballs; A.airballOOB += S.airballOOB; A.untouched += S.untouchedMiss; A.untouchedOOB += S.untouchedMissOOB;
    }
    for (const ps of m.possessions) { T[ps.team].poss++; T[ps.team].liveSec += ps.liveSec; }
    if (r.g.score[0] !== r.g.score[1]) T[r.g.score[0] > r.g.score[1] ? 0 : 1].wins++;
    for (const id in m.player) {
      const s = m.player[id];
      const a = P[id] || (P[id] = { team: s.team, fga: 0, rim: 0, close: 0, mid: 0, three: 0, pa3: 0, moves: 0, jabs: 0, pumpFakes: 0, post: 0, touches: 0, hp: 0, ast: 0, drives: 0, jumpers: 0, stepbacks: 0, fgm: 0, pts: 0 });
      a.fga += s.fga; a.fgm += s.fgm; a.pts += s.pts; a.rim += s.zone.rim.a; a.close += s.zone.close.a; a.mid += s.zone.mid.a; a.three += s.zone.three.a; a.pa3 += s.pa3;
      a.moves += s.moves; a.jabs += s.jabs; a.pumpFakes += s.pumpFakes; a.post += s.postTouches; a.touches += s.touches; a.hp += s.handlerPossessions;
      a.ast += s.assists; a.drives += s.drives; a.jumpers += s.jumpers; a.stepbacks += s.stepbacks;
      for (const v of s.catchToPress) ctp.push(v);
      for (const v of s.releaseSpeed) rel.push(v);
      for (const k in s.abilities) abilities[k] = (abilities[k] || 0) + s.abilities[k];
    }
    for (const s of m.shots) shots.push(s);
  }
  return { T, P, abilities, invariants, giannisThrees, giannisClosed, ctp, rel, shots };
}

const median = (a) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
const fgPct = (A) => ratio(A.fgm, A.fga);

// ------------------------------------------------------------------------------------------------ band A
let bandAShots = null;
function bandA() {
  section(`Band A — CPU vs CPU, normal, seeds ${SEEDS_A[0]}–${SEEDS_A[SEEDS_A.length - 1]}, q = ${Q}`);
  const runs = [];
  for (const seed of SEEDS_A) {
    const r = runGame({ seed, q: Q, auto: true, difficulty: 'normal' });
    runs.push(r);
    if (VERBOSE) console.log(`  seed ${seed}: ${r.g.score.join(':')} steps ${r.extra.steps}`);
  }
  const Agg = aggregate(runs);
  bandAShots = Agg.shots;
  const W = WIDEN;
  const teamName = (t) => (t === 0 ? 'DARK (lebron/kyrie/giannis)' : 'BRIGHT (jordan/kobe/yao)');
  for (let t = 0; t < 2; t++) {
    const A = Agg.T[t], O = Agg.T[1 - t];
    console.log(`-- team ${t} ${teamName(t)}: FG ${A.fgm}/${A.fga}, pts ${A.pts}, possessions ${A.poss}`);
    check(`A team ${t} FG%`, pct(fgPct(A)), inBand(fgPct(A), 0.42 - W, 0.58 + W), '42–58 %');
    check(`A team ${t} 3PA / FGA`, pct(ratio(A.pa3, A.fga)), inBand(ratio(A.pa3, A.fga), 0.12 - W, 0.35 + W), '12–35 %');
    check(`A team ${t} rim FGA share`, pct(ratio(A.rim, A.fga)), inBand(ratio(A.rim, A.fga), 0.25 - W, 0.50 + W), '25–50 %');
    check(`A team ${t} drive-finished FGA`, pct(ratio(A.drivesFinished, A.fga)), ratio(A.drivesFinished, A.fga) >= 0.15 - W, '≥ 15 %');
    const yaoDef = runs[0].g.byId.yao.team === t;
    const blk = ratio(A.blk, O.fga);
    check(`A team ${t} blocks / opponent FGA${yaoDef ? ' (Yao defence)' : ''}`, pct(blk), yaoDef ? inBand(blk, 0.03 - W, 0.12 + W) : inBand(blk, 0.03 - W, 0.08 + W), yaoDef ? '3–12 %' : '3–8 %');
    const stl = ratio(A.stl, O.poss);
    check(`A team ${t} steals / defensive possession`, pct(stl), inBand(stl, 0.04 - W, 0.10 + W), '4–10 %');
    check(`A team ${t} turnovers / possession`, pct(ratio(A.tov, A.poss)), inBand(ratio(A.tov, A.poss), 0.08 - W, 0.18 + W), '8–18 %');
    check(`A team ${t} shot-clock violations / possession`, pct(ratio(A.shotClock, A.poss)), ratio(A.shotClock, A.poss) <= 0.04 + W, '≤ 4 %');
    check(`A team ${t} mean liveSec`, f2(ratio(A.liveSec, A.poss)) + ' s', inBand(ratio(A.liveSec, A.poss), 5.5 - 10 * W, 10.0 + 10 * W), '5.5–10.0 s');
    check(`A team ${t} PPP`, f2(ratio(A.pts, A.poss)), inBand(ratio(A.pts, A.poss), 0.85 - W, 1.25 + W), '0.85–1.25');
    check(`A team ${t} CPU passes intercepted / deflected`, `${pct(ratio(A.intdef, A.passes))} (${A.intdef}/${A.passes})`, inBand(ratio(A.intdef, A.passes), 0.02 - W, 0.06 + W), '2–6 %');
  }
  for (let t = 0; t < 2; t++) {
    const zs = { rim: [0, 0], close: [0, 0], mid: [0, 0], three: [0, 0] };
    const kinds = {};
    for (const s of Agg.shots) {
      if (s.team !== t) continue;
      zs[s.zone][0]++; if (s.scored) zs[s.zone][1]++;
      const k = kinds[s.kind] || (kinds[s.kind] = [0, 0, 0]); k[0]++; if (s.scored) k[1]++; k[2] += s.C;
    }
    const tv = runs.reduce((a, r) => { const T = r.m.team[t].tov; a.steal += T.steal; a.intercept += T.intercept; a.oob += T.oob; a.shotClock += T.shotClock; return a; }, { steal: 0, intercept: 0, oob: 0, shotClock: 0 });
    console.log(`   team ${t} zone FG: ` + Object.entries(zs).map(([z, v]) => `${z} ${v[1]}/${v[0]} ${pct(ratio(v[1], v[0]))}`).join(', ')
      + ` | kinds: ` + Object.entries(kinds).map(([k, v]) => `${k} ${v[1]}/${v[0]} C ${f2(v[2] / v[0])}`).join(', ') + ` | tov ${JSON.stringify(tv)}`);
  }
  const ctp = Agg.ctp;
  check('A catchToPress median', f2(median(ctp)) + ' s', median(ctp) >= 0.45, '≥ 0.45 s');
  check('A catchToPress share < 0.25 s', pct(ratio(ctp.filter((v) => v < 0.25).length, ctp.length)) + ` (n ${ctp.length})`, ctp.every((v) => v >= 0.25), '0 %');
  const relShare = ratio(Agg.rel.filter((v) => v > 2.5).length, Agg.rel.length);
  check('A jumpers with releaseSpeed > 2.5 m/s', pct(relShare), relShare <= 0.25 + W, '≤ 25 %');
  const ankles = (Agg.T[0].ankles + Agg.T[1].ankles) / runs.length;
  check('A ankle-breaks per game (both teams)', f2(ankles), inBand(ankles, 0.2, 3.0), '0.2–3.0');
  const ab = Agg.T[0].airballs + Agg.T[1].airballs, abO = Agg.T[0].airballOOB + Agg.T[1].airballOOB;
  check('A air balls ending OOB', `${pct(ratio(abO, ab))} (${abO}/${ab})`, ab === 0 || abO / ab <= 0.20, '≤ 20 %');
  const um = Agg.T[0].untouched + Agg.T[1].untouched, umO = Agg.T[0].untouchedOOB + Agg.T[1].untouchedOOB;
  check('A untouched misses ending OOB', `${pct(ratio(umO, um))} (${umO}/${um})`, um === 0 || umO / um <= 0.25, '≤ 25 %');
  const missing = ABILITY_IDS.filter((id) => id !== 'jordan.ftDunk' && id !== 'lebron.chaseDown' && !(Agg.abilities[id] > 0));
  check('A abilities triggered / applied ≥ 1 (all but ftDunk, chaseDown)', missing.length ? 'missing ' + missing.join(',') : `${ABILITY_IDS.length - 2}/${ABILITY_IDS.length - 2}`, missing.length === 0, 'every id');
  console.log('   ability counts: ' + ABILITY_IDS.map((id) => `${id} ${Agg.abilities[id] || 0}`).join(', '));
  check('A invariants (NaN, ball y ≥ 0.10, shot clock ∈ [0, 14])', Agg.invariants, Agg.invariants === 0, '0');
  legendStyle(Agg, runs);
}

function legendStyle(Agg, runs) {
  section('Band A — per-legend style (pooled; a legend is checked only with ≥ 40 FGA)');
  console.log('legend    FGA   FG%    rim   close  mid   three | profile r/m/t       moves  jabs  pf  post/touch  hp   ast  drives  sb/jumpers');
  for (const id of Object.keys(LEGENDS)) {
    const a = Agg.P[id];
    if (!a) continue;
    const mix = profileMix(id);
    console.log(`${id.padEnd(8)} ${String(a.fga).padStart(4)}  ${pct(ratio(a.fgm, a.fga)).padStart(6)}  ${pct(ratio(a.rim, a.fga)).padStart(6)} ${pct(ratio(a.close, a.fga)).padStart(6)} ${pct(ratio(a.mid, a.fga)).padStart(6)} ${pct(ratio(a.three, a.fga)).padStart(6)} | ${mix.rim.toFixed(2)}/${mix.mid.toFixed(2)}/${mix.three.toFixed(2)}`
      + `      ${String(a.moves).padStart(4)} ${String(a.jabs).padStart(5)} ${String(a.pumpFakes).padStart(3)}  ${String(a.post).padStart(4)}/${String(a.touches).padEnd(5)} ${String(a.hp).padStart(4)} ${String(a.ast).padStart(4)} ${String(a.drives).padStart(6)}  ${a.stepbacks}/${a.jumpers}`);
  }
  const P = Agg.P;
  const enough = (id) => P[id] && P[id].fga >= 40;
  const share = (id, z) => ratio(P[id][z], P[id].fga);
  if (enough('yao')) {
    check('A Yao 3PA share', pct(ratio(P.yao.pa3, P.yao.fga)), ratio(P.yao.pa3, P.yao.fga) <= 0.01, '≤ 1 %');
    check('A Yao post touches / touches', pct(ratio(P.yao.post, P.yao.touches)), ratio(P.yao.post, P.yao.touches) >= 0.40, '≥ 40 %');
  } else check('A Yao has ≥ 40 FGA for the style checks', P.yao ? P.yao.fga : 0, false, '≥ 40');
  if (enough('giannis')) {
    check('A Giannis 3PA share', pct(ratio(P.giannis.pa3, P.giannis.fga)), ratio(P.giannis.pa3, P.giannis.fga) <= 0.20, '≤ 20 %');
    check('A Giannis non-urgent threes with openness < 2.5 m', `${Agg.giannisClosed}/${Agg.giannisThrees}`, Agg.giannisClosed === 0, '0');
  } else check('A Giannis has ≥ 40 FGA for the style checks', P.giannis ? P.giannis.fga : 0, false, '≥ 40');
  if (enough('kobe')) check('A Kobe mid share', pct(share('kobe', 'mid')), share('kobe', 'mid') >= 0.35, '≥ 35 %');
  if (enough('jordan')) check('A Jordan mid share', pct(share('jordan', 'mid')), share('jordan', 'mid') >= 0.30, '≥ 30 %');
  if (enough('lebron')) {
    check('A LeBron rim share', pct(share('lebron', 'rim')), share('lebron', 'rim') >= 0.35, '≥ 35 %');
    const mates = Object.keys(P).filter((id) => P[id].team === P.lebron.team && id !== 'lebron');
    const most = mates.every((id) => P.lebron.ast > P[id].ast);
    check('A LeBron most assists on his team', `${P.lebron.ast} vs ${mates.map((id) => id + ' ' + P[id].ast).join(', ')}`, most, 'most');
  }
  if (enough('kyrie')) {
    const mpp = ratio(P.kyrie.moves, P.kyrie.hp);
    check('A Kyrie dribble moves per handler possession', f2(mpp), mpp >= 1.5, '≥ 1.5');
    check('A Kyrie stepbacks / jumpers', pct(ratio(P.kyrie.stepbacks, P.kyrie.jumpers)), ratio(P.kyrie.stepbacks, P.kyrie.jumpers) >= 0.20, '≥ 20 %');
  }
  for (const id of Object.keys(LEGENDS)) {
    if (!enough(id)) continue;
    const mix = profileMix(id);
    const r = share(id, 'rim'), m = share(id, 'mid'), t = share(id, 'three');
    const ok = Math.abs(r - mix.rim) <= 0.12 && Math.abs(m - mix.mid) <= 0.12 && Math.abs(t - mix.three) <= 0.12;
    check(`A ${id} rim/mid/three within ±12 pts of the profile`, `${(100 * r).toFixed(0)}/${(100 * m).toFixed(0)}/${(100 * t).toFixed(0)} vs ${(100 * mix.rim).toFixed(0)}/${(100 * mix.mid).toFixed(0)}/${(100 * mix.three).toFixed(0)}`, ok, '±12 pts');
  }
}

// ------------------------------------------------------------------------------------------------ bands B and C
function bandB() {
  section(`Band B — idle human (bot 'idle'), seeds ${SEEDS_BC[0]}–${SEEDS_BC[SEEDS_BC.length - 1]}, q = ${Q}`);
  const fg = {}, ppp = {};
  for (const diff of ['easy', 'normal', 'hard']) {
    const runs = SEEDS_BC.map((seed) => runGame({ seed, q: Q, auto: false, difficulty: diff, bot: 'idle' }));
    const Agg = aggregate(runs);
    const cpu = Agg.T[1];                       // the user plays lineup side 'a' (team 0)
    fg[diff] = fgPct(cpu); ppp[diff] = ratio(cpu.pts, cpu.poss);
    const band = { easy: [0.40, 0.52], normal: [0.48, 0.60], hard: [0.55, 0.68] }[diff];
    check(`B CPU FG% ${diff}`, `${pct(fg[diff])} (${cpu.fgm}/${cpu.fga})`, inBand(fg[diff], band[0], band[1]), `${Math.round(band[0] * 100)}–${Math.round(band[1] * 100)} %`);
    console.log(`     CPU PPP ${diff} ${f2(ppp[diff])}, possessions ${cpu.poss}, rim ${pct(ratio(cpu.rim, cpu.fga))}, three ${pct(ratio(cpu.pa3, cpu.fga))}`);
  }
  check('B CPU FG% strictly increasing, gaps ≥ 4 pts', `${pct(fg.easy)} < ${pct(fg.normal)} < ${pct(fg.hard)}`, fg.normal - fg.easy >= 0.04 && fg.hard - fg.normal >= 0.04, 'gaps ≥ 4');
  check('B CPU PPP easy', f2(ppp.easy), ppp.easy <= 1.05, '≤ 1.05');
  check('B CPU PPP hard', f2(ppp.hard), ppp.hard >= 1.10, '≥ 1.10');
}

function bandC() {
  section(`Band C — average human (bot 'avg'), FG% seeds ${SEEDS_BC[0]}–${SEEDS_BC[SEEDS_BC.length - 1]}, win share over ${SEEDS_WIN.length} games, q = ${Q}`);
  const B = { easy: { h: [0.52, 0.68], c: [0.38, 0.50], w: [0.70, 1] }, normal: { h: [0.45, 0.60], c: [0.44, 0.56], w: [0.35, 0.75] }, hard: { h: [0.38, 0.54], c: [0.50, 0.62], w: [0, 0.45] } };
  for (const diff of ['easy', 'normal', 'hard']) {
    const runs = SEEDS_WIN.map((seed) => runGame({ seed, q: Q, auto: false, difficulty: diff, bot: 'avg' }));
    const fgRuns = runs.filter((r, i) => SEEDS_BC.indexOf(SEEDS_WIN[i]) >= 0);
    const Agg = aggregate(fgRuns), All = aggregate(runs);
    const hum = Agg.T[0], cpu = Agg.T[1];
    const b = B[diff];
    check(`C human-team FG% ${diff}`, `${pct(fgPct(hum))} (${hum.fgm}/${hum.fga})`, inBand(fgPct(hum), b.h[0], b.h[1]), `${Math.round(b.h[0] * 100)}–${Math.round(b.h[1] * 100)} %`);
    check(`C CPU FG% ${diff}`, `${pct(fgPct(cpu))} (${cpu.fgm}/${cpu.fga})`, inBand(fgPct(cpu), b.c[0], b.c[1]), `${Math.round(b.c[0] * 100)}–${Math.round(b.c[1] * 100)} %`);
    const ws = ratio(All.T[0].wins, runs.length);
    const wb = diff === 'easy' ? '≥ 0.70' : diff === 'normal' ? '0.35–0.75' : '≤ 0.45';
    check(`C human win share ${diff}`, `${f2(ws)} (${All.T[0].wins}/${runs.length})`, inBand(ws, b.w[0], b.w[1]), wb);
  }
}

// ------------------------------------------------------------------------------------------------ scenarios
const FROZEN_AI = { updateAI() {}, resetAI: AI.resetAI, assignMatchups: AI.assignMatchups };

function stepN(g, k, bot) { for (let i = 0; i < k; i++) { if (bot) bot.step(FIXED_DT); g.step(FIXED_DT); } }

/** S1 / S2: scripted drives / pull-ups of the user (default handler) against the CPU defence. */
function drivePossessions(mode, diff, N, seed) {
  const g = new Game({ scene: null, anim: 'proxy', seed, quarterSec: 300, auto: false, difficulty: diff, ai: AI });
  const bot = new TestBot(g, { seed }); bot.set(mode); g.input = bot;
  const user = g.world.user;
  const st = { poss: 0, scores: 0, blocked: 0, stripped: 0, shots: 0 };
  let cur = null;
  g.on('*', (e, t) => {
    if (!cur) return;
    if (t === 'shot' && e.team === user) cur.shot = true;
    if (t === 'score' && e.team === user) cur.score = true;
    if (t === 'block' && e.team !== user) cur.blk = true;
    if ((t === 'steal' || t === 'intercept') && e.team !== user && !cur.shot) cur.strip = true;
  });
  g.start({ auto: false, difficulty: diff });
  let guard = 0;
  while (st.poss < N && guard++ < 400000) {
    const w = g.world;
    if (w.state === 'GAME_OVER') g.start({ auto: false, difficulty: diff });
    if (w.state === 'LIVE' && w.offense !== user) { g.turnover(); }
    if (w.state === 'LIVE' && w.offense === user && !cur) { cur = { shot: false, score: false, blk: false, strip: false }; g.setClock({ game: 250 }); }
    bot.step(FIXED_DT); g.step(FIXED_DT);
    if (cur && g.world.state !== 'LIVE') {
      st.poss++; st.shots += cur.shot ? 1 : 0; st.scores += cur.score ? 1 : 0; st.blocked += cur.blk ? 1 : 0; st.stripped += cur.strip ? 1 : 0;
      cur = null;
    }
  }
  return st;
}

function S1() {
  section('S1 first-timer drive (bot drive, n 30 per difficulty)');
  const r = {};
  for (const diff of ['easy', 'normal', 'hard']) {
    r[diff] = drivePossessions('drive', diff, 30, 5);
    const s = r[diff];
    console.log(`     ${diff}: possessions ${s.poss}, shots ${s.shots}, scores ${s.scores}, blocked ${s.blocked}, stripped ${s.stripped}`);
  }
  const sc = (d) => r[d].scores / r[d].poss, bl = (d) => r[d].blocked / r[d].poss, sp = (d) => r[d].stripped / r[d].poss;
  check('S1 normal scores', pct(sc('normal')), inBand(sc('normal'), 0.35, 0.65), '35–65 %');
  check('S1 normal blocked', pct(bl('normal')), bl('normal') <= 0.25, '≤ 25 %');
  check('S1 normal stripped before the shot', pct(sp('normal')), sp('normal') <= 0.20, '≤ 20 %');
  check('S1 easy scores', pct(sc('easy')), sc('easy') >= 0.50, '≥ 50 %');
  check('S1 easy blocked', pct(bl('easy')), bl('easy') <= 0.12, '≤ 12 %');
  check('S1 hard scores', pct(sc('hard')), inBand(sc('hard'), 0.25, 0.55), '25–55 %');
  check('S1 hard blocked', pct(bl('hard')), bl('hard') <= 0.35, '≤ 35 %');
  check('S1 normal ≥ 0.6 × easy', `${pct(sc('normal'))} vs ${pct(0.6 * sc('easy'))}`, sc('normal') >= 0.6 * sc('easy'), 'no cliff');
}

function S2() {
  section('S2 pull-up near the defender (bot pullup, n 30, normal)');
  const s = drivePossessions('pullup', 'normal', 30, 5);
  console.log(`     possessions ${s.poss}, shots ${s.shots}, scores ${s.scores}, blocked ${s.blocked}, stripped ${s.stripped}`);
  check('S2 normal blocked', pct(s.blocked / s.poss), s.blocked / s.poss <= 0.20, '≤ 20 %');
  check('S2 normal scores', pct(s.scores / s.poss), inBand(s.scores / s.poss, 0.25, 0.55), '25–55 %');
}

/** Stages the user's default handler at distance d straight in front of the rim, his CPU defender at (gapOverride ?? natural gap). */
function stageShooter(g, d, gapOverride) {
  const w = g.world, user = w.user;
  const sh = g.roster[user][0];
  g.stageLive(user, sh);
  g.setControlled(sh);
  g.teleport(sh, 0, RIM.z + d, Math.PI);
  const def = g.players.find((q) => q.defAssign === sh) || g.roster[1 - user][0];
  const gap = gapOverride !== undefined ? gapOverride : onBallGap(def, sh, w.difficulty.defGap);
  g.teleport(def, 0, RIM.z + d - gap, 0);
  return { sh, def };
}

/** Steps until the shot of `sh` is over (block, make, miss) or `maxS` seconds. */
function resolveShotTrial(g, sh, maxS) {
  let blocked = false, released = false, dist = NaN;
  const off = [g.on('block', (e) => { if (e.shooterId === sh.id) blocked = true; }), g.on('release', (e) => { if (e.playerId === sh.id) released = true; })];
  const def = g.players.find((q) => q.defAssign === sh);
  const relHook = g.on('release', (e) => { if (e.playerId === sh.id && def) dist = Math.hypot(def.pos.x - sh.pos.x, def.pos.z - sh.pos.z); });
  for (let i = 0; i < maxS * 60; i++) {
    g.step(FIXED_DT);
    if (released && g.ball.state !== 'flight') break;
    if (g.world.state !== 'LIVE') break;
  }
  off.forEach((o) => o()); relHook();
  return { blocked, released, dist };
}

function S3() {
  section('S3 block probe (human debugShoot eT 0, CPU on-ball defender at its natural gap, hard, n 60)');
  for (const [d, cap] of [[6.0, 0.15], [4.5, 0.10]]) {
    const g = new Game({ scene: null, anim: 'proxy', seed: 3, quarterSec: 300, auto: false, difficulty: 'hard', ai: AI });
    g.start({ auto: false, difficulty: 'hard' });
    let blocks = 0, n0 = 0;
    for (let k = 0; k < 60; k++) {
      const { sh } = stageShooter(g, d);
      stepN(g, 12);                                           // the defender settles at his gap
      g.teleport(sh, 0, RIM.z + d, Math.PI);
      if (!g.debugShoot({ shooter: sh.id, eT: 0, kind: 'jumper' })) continue;
      n0++;
      if (resolveShotTrial(g, sh, 3).blocked) blocks++;
      g.setClock({ game: 250, shot: 14 });
    }
    check(`S3 blocked from ${d.toFixed(1)} m`, `${pct(blocks / n0)} (${blocks}/${n0})`, blocks / n0 <= cap, `≤ ${cap * 100} %`);
  }
}

function S4() {
  section('S4 no back-off (defender 0.91 m in front, debugShoot eT 0, n 60)');
  for (const diff of ['easy', 'normal']) {
    const g = new Game({ scene: null, anim: 'proxy', seed: 4, quarterSec: 300, auto: false, difficulty: diff, ai: AI });
    g.start({ auto: false, difficulty: diff });
    let ok = 0, n0 = 0, sum = 0;
    for (let k = 0; k < 60; k++) {
      const { sh } = stageShooter(g, 5.0, 0.91);
      if (!g.debugShoot({ shooter: sh.id, eT: 0, kind: 'jumper' })) continue;
      const r = resolveShotTrial(g, sh, 3);
      if (!Number.isFinite(r.dist)) continue;
      n0++; sum += r.dist;
      if (r.dist <= 1.00) ok++;
      g.setClock({ game: 250, shot: 14 });
    }
    check(`S4 ${diff}: distance at release ≤ 1.00 m`, `${pct(ok / n0)} (${ok}/${n0}, mean ${f2(sum / n0)} m)`, ok / n0 >= 0.90, '≥ 90 %');
  }
}

function S5() {
  section('S5 catch gate (auto, normal, ≥ 40 CPU catch-to-press samples)');
  // band A's shots when band A ran; else whole auto games from seed 5 on until ≥ 40 samples
  let s = (bandAShots || []).filter((x) => Number.isFinite(x.catchToPress) && !x.urgent);
  for (let seed = 5; !bandAShots && s.length < 40 && seed < 15; seed++) {
    const r = runGame({ seed, q: 120, auto: true });
    for (const x of r.m.shots) if (Number.isFinite(x.catchToPress) && !x.urgent) s.push(x);
  }
  const bad = s.filter((x) => x.catchToPress < 0.40);
  check('S5 catchToPress ≥ 0.40 s for every non-urgent shot', `${s.length - bad.length}/${s.length} (min ${f2(Math.min(...s.map((x) => x.catchToPress)))} s)`, s.length >= 40 && bad.length === 0, '100 %, n ≥ 40');
}

function S6() {
  section('S6 interception (defender 0.3 m off a 6 m chest-pass line, n 30) + bestPassTarget risk');
  const g = new Game({ scene: null, anim: 'proxy', seed: 6, quarterSec: 300, auto: true, ai: FROZEN_AI });
  g.start({ auto: true });
  let hits = 0, n0 = 0;
  for (let k = 0; k < 30; k++) {
    const h = g.byId.lebron, r = g.byId.kyrie, d = g.byId.kobe;
    g.stageLive(h.team, h);
    g.teleport(h, -3, -7, Math.PI / 2); g.teleport(r, 3, -7, -Math.PI / 2); g.teleport(d, 0, -7 + 0.3, 0);
    for (const q of g.players) if (q !== h && q !== r && q !== d) g.teleport(q, q.team === h.team ? -6 : 6, -2, 0);
    h.passTarget = r;
    const t = g.world.time * 1000 + 16;
    pressButton(h.intent.secondary, t); releaseButton(h.intent.secondary, t);
    let ev = false;
    const off = [g.on('intercept', () => { ev = true; }), g.on('deflect', () => { ev = true; })];
    for (let i = 0; i < 90; i++) { g.step(FIXED_DT); clearEdges(h.intent); if (g.ball.state !== 'pass' && i > 30) break; }
    off.forEach((o) => o());
    n0++; if (ev) hits++;
    if (g.world.state !== 'LIVE') stepN(g, 200);
  }
  check('S6 intercepted or deflected', `${pct(hits / n0)} (${hits}/${n0})`, hits / n0 >= 0.30, '≥ 30 %');
  // bestPassTarget never returns a pass above riskTol (random placements, every handler, each difficulty column)
  const g2 = new Game({ scene: null, anim: 'proxy', seed: 7, quarterSec: 300, auto: true, ai: FROZEN_AI });
  g2.start({ auto: true });
  let returned = 0, worst = 0, over = 0;
  const rng = g2.rng;
  for (let k = 0; k < 300; k++) {
    for (const q of g2.players) g2.teleport(q, rng.range(-7, 7), rng.range(-13.5, -1), rng.range(-Math.PI, Math.PI));
    for (const h of g2.players) {
      if (h.team !== g2.world.offense) continue;
      const out = { player: null, score: 0, risk: 0, ep: 0, lob: false, x: 0, z: 0 };
      const recv = AI.bestPassTarget(h, g2.world, out);
      if (!recv) continue;
      returned++;
      const tol = riskTolOf(h, DIFFICULTY.normal);
      if (out.risk > tol + 1e-9) over++;
      if (out.risk / tol > worst) worst = out.risk / tol;
    }
  }
  check('S6 bestPassTarget risk ≤ riskTol', `${over} over (${returned} passes, max risk/tol ${f2(worst)})`, over === 0 && returned > 0, 'never above');
}

function S7() {
  section('S7 rating fixtures (n 400 each: debugBlock, debugSteal, forced ankle)');
  const g = new Game({ scene: null, anim: 'proxy', seed: 8, quarterSec: 300, auto: true, ai: FROZEN_AI });
  g.start({ auto: true });
  const blockCases = [['yao', 'kyrie', 'jumper'], ['giannis', 'jordan', 'layup'], ['lebron', 'kobe', 'hook'], ['kobe', 'lebron', 'jumper']];
  for (const [b, s, kind] of blockCases) {
    const sh = g.byId[s];
    g.stageLive(sh.team, sh); g.teleport(sh, 0, RIM.z + (kind === 'layup' ? 1.5 : kind === 'hook' ? 2.5 : 5.0), Math.PI);
    let hits = 0, pB = 0;
    for (let k = 0; k < 400; k++) { const r = g.debugBlock({ blocker: b, shooter: s, kind, contact: true }); pB = r.pB; if (r.blocked) hits++; }
    check(`S7 debugBlock ${b} vs ${s} ${kind}`, `${f2(hits / 400)} vs pB ${f2(pB)}`, Math.abs(hits / 400 - pB) <= 0.05, '±0.05');
  }
  for (const [d, h] of [['jordan', 'kyrie'], ['kyrie', 'yao'], ['kobe', 'lebron']]) {
    const hp = g.byId[h], dp = g.byId[d];
    g.stageLive(hp.team, hp); g.teleport(hp, 0, -7, Math.PI); g.startDribble(hp); g.teleport(dp, 0, -7.7, 0);
    let hits = 0, pp = 0, elig = 0;
    for (let k = 0; k < 400; k++) { const r = g.debugSteal({ stealer: d, handler: h }); pp = r.pPoke; if (r.eligible) elig++; if (r.stolen) hits++; }
    check(`S7 debugSteal ${d} on ${h}`, `${f2(hits / 400)} vs pPoke ${f2(pp)} (eligible ${elig})`, elig === 400 && Math.abs(hits / 400 - pp) <= 0.05, '±0.05');
  }
  let ank = 0, pA = 0;
  for (let k = 0; k < 400; k++) { const r = g.debugShake({ handler: 'kyrie', defender: 'yao', move: 'move.cross', combo: 2, committed: true }); pA = r.pAnkle; if (r.outcome === 'ankle') ank++; }
  check('S7 forced ankle (Kyrie 2nd combo move vs committed Yao)', `${f2(ank / 400)} vs pAnkle ${f2(pA)}`, Math.abs(ank / 400 - pA) <= 0.05, '±0.05');
}

function S8() {
  section('S8 points at release (n 10 each)');
  const g = new Game({ scene: null, anim: 'proxy', seed: 9, quarterSec: 300, auto: false, ai: AI });
  g.start({ auto: false });
  let sprintOK = 0, standOK = 0, nS = 0, nT = 0;
  for (const moving of [true, false]) {
    for (let k = 0; k < 10; k++) {
      const w = g.world, sh = g.roster[w.user][0];
      g.stageLive(w.user, sh); g.setControlled(sh);
      const it = sh.intent;
      const press = LINES_THREE + 0.1;
      if (moving) g.stageRun(sh, 0, RIM.z + press + 1.6, 7.0); else g.teleport(sh, 0, RIM.z + press, Math.PI);
      if (!moving) g.startDribble(sh);
      let pressed = false, pressT = 0, points = -1, guard = 0;
      const off = g.on('release', (e) => { if (e.playerId === sh.id) points = e.points; });
      while (points < 0 && guard++ < 240 && g.world.state === 'LIVE') {
        clearEdges(it);
        const d = Math.hypot(sh.pos.x - RIM.x, sh.pos.z - RIM.z);
        if (moving && !pressed) { it.move.x = 0; it.move.z = -1; it.move.mag = 1; it.sprint = true; }
        const ms = (g.world.time + FIXED_DT) * 1000;
        if (!pressed && (!moving || d <= press)) { it.move.mag = 0; it.move.x = 0; it.move.z = 0; it.sprint = false; pressButton(it.primary, ms); pressed = true; pressT = g.world.time + FIXED_DT; }
        else if (pressed && it.primary.held) {
          const el = g.world.time + FIXED_DT - pressT;
          const target = moving ? (d <= LINES_THREE - 0.4 && el >= 0.13) || el >= sh.shot.tIdeal : el >= sh.shot.tIdeal;
          if (target) releaseButton(it.primary, ms);
        }
        g.step(FIXED_DT);
      }
      off();
      if (moving) { nS++; if (points === 2) sprintOK++; } else { nT++; if (points === 3) standOK++; }
      stepN(g, 120);
    }
  }
  check('S8 sprinting: press 0.1 m outside, release inside → 2', `${sprintOK}/${nS}`, sprintOK === nS && nS === 10, '10/10');
  check('S8 stationary 0.1 m outside → 3', `${standOK}/${nT}`, standOK === nT && nT === 10, '10/10');
}
const LINES_THREE = 7.24;

function S9() {
  section('S9 FT-line dunk (forceAbility, n 10)');
  const g = new Game({ scene: null, anim: 'proxy', seed: 10, quarterSec: 300, auto: true, ai: AI });
  g.start({ auto: true });
  let clipOK = 0, plus2 = 0, logged = 0;
  for (let k = 0; k < 10; k++) {
    const jordan = g.byId.jordan;
    jordan.cx.ftDunks = 0;
    const before = g.abilityLog.count('jordan.ftDunk');
    const sc0 = g.score[jordan.team];
    const ok = g.forceAbility('jordan.ftDunk');
    if (ok && jordan.shot.clipId === 'sig.jordan.ftDunk') clipOK++;
    if (g.abilityLog.count('jordan.ftDunk') > before) logged++;
    let guard = 0;
    while (g.world.state === 'LIVE' && guard++ < 300) g.step(FIXED_DT);
    if (g.score[jordan.team] - sc0 === 2) plus2++;
    stepN(g, 150);
  }
  check('S9 clip sig.jordan.ftDunk', `${clipOK}/10`, clipOK === 10, '10/10');
  check('S9 score +2', `${plus2}/10`, plus2 >= 9, '≥ 9/10 (make p 0.97)');
  check('S9 abilityLog entry', `${logged}/10`, logged === 10, '10/10');
  const jordan = g.byId.jordan;
  g.stageLive(jordan.team, jordan); jordan.cx.ftDunks = 0;
  g.stageRun(jordan, 0, RIM.z + 5.99, 6.6);
  const r599 = resolveShot(jordan, g.world);
  const v599 = r599.variant;
  g.stageRun(jordan, 0, RIM.z + 6.00, 6.6);
  const v600 = resolveShot(jordan, g.world).variant;
  check('S9 press at d 5.99 → not ftDunk; 6.00 → ftDunk', `${v599} / ${v600}`, v599 !== 'ftDunk' && v600 === 'ftDunk', 'boundary');
}

function S10() {
  section('S10 chase-down (Kobe layup from 1.8 m, LeBron 2.5 m behind sprinting, forced jump, n 100)');
  const make = () => {
    const g = new Game({ scene: null, anim: 'proxy', seed: 11, quarterSec: 300, auto: false, ai: FROZEN_AI, lineup: { a: ['lebron', 'kyrie', 'giannis'], b: ['kobe', 'jordan', 'yao'], user: 'a', kits: 'auto' } });
    g.start({ auto: false });
    return g;
  };
  const trial = (g, offset) => {
    const kobe = g.byId.kobe, lebron = g.byId.lebron;
    g.stageLive(kobe.team, kobe);
    g.setControlled(lebron);
    g.stageRun(kobe, 0, RIM.z + 1.8, 4.0);
    g.teleport(lebron, 0, RIM.z + 4.3, Math.PI); lebron.vel.set(0, 0, -lebron.attrs.run * lebron.attrs.sprintMul);
    lebron.defAssign = kobe;
    for (const q of g.players) if (q !== kobe && q !== lebron) g.teleport(q, q.team === kobe.team ? -6.5 : 6.5, -2, 0);
    g.debugShoot({ shooter: 'kobe', kind: 'layup', variant: 'std', eT: 0 });
    let pressed = false, eligible = false, blocked = false;
    const off = g.on('block', (e) => { if (e.blockerId === 'lebron') blocked = true; });
    for (let i = 0; i < 90; i++) {
      clearEdges(lebron.intent);
      const el = g.world.time + FIXED_DT - kobe.shot.pressT;
      lebron.intent.move.x = 0; lebron.intent.move.z = -1; lebron.intent.move.mag = 1; lebron.intent.sprint = true;
      if (!pressed && el >= offset) { const ms = (g.world.time + FIXED_DT) * 1000; pressButton(lebron.intent.primary, ms); releaseButton(lebron.intent.primary, ms); pressed = true; }
      g.step(FIXED_DT);
      if (g.blockRolled[lebron.idx]) eligible = true;
      if (g.world.state !== 'LIVE') break;
    }
    off();
    stepN(g, 100);
    return { eligible, blocked };
  };
  // the predicted apex: the press offset that maximises contact in a pilot sweep (5 trials per offset)
  const pilot = make();
  let bestOff = 0, bestE = -1;
  for (let off = 0.0; off <= 0.50 + 1e-9; off += 0.02) {
    let e = 0;
    for (let k = 0; k < 5; k++) if (trial(pilot, off).eligible) e++;
    if (e > bestE) { bestE = e; bestOff = off; }
  }
  const g = make();
  let elig = 0, blk = 0;
  for (let k = 0; k < 100; k++) { const r = trial(g, bestOff); if (r.eligible) { elig++; if (r.blocked) blk++; } }
  const L = LEGENDS.lebron, K = LEGENDS.kobe;
  const blkF = 0.35 + 0.85 * n(L.ratings.block), hAdv = Math.min(1.35, Math.max(0.60, 1 + 0.625 * (L.stats.heightM - K.stats.heightM)));
  const pF = Math.min(0.55, 0.50 * blkF * hAdv) * DIFFICULTY.normal.userBlockMul;
  check('S10 eligible', `${elig}/100 (press offset ${bestOff.toFixed(2)} s)`, elig >= 70, '≥ 70 %');
  check('S10 block rate vs min(0.55, 0.50 × blkF × hAdv)', `${f2(blk / Math.max(1, elig))} vs ${f2(pF)}`, Math.abs(blk / Math.max(1, elig) - pF) <= 0.05, '±0.05');
}

function S11() {
  section('S11 rematch timers (auto, q 120, seed 3: CPU poke attempts in the first 120 s)');
  const g = new Game({ scene: null, anim: 'proxy', seed: 3, quarterSec: 120, auto: true, ai: AI });
  let count = 0, counting = true;
  const orig = g.startPoke;
  g.startPoke = function (p, human) { const r = orig.call(this, p, human); if (r && counting && this.world.time <= 120) count++; return r; };
  g.start({ auto: true });
  while (g.state !== 'GAME_OVER') g.step(FIXED_DT);
  const g1 = count;
  count = 0;
  g.rematch();
  while (g.world.time <= 120 && g.state !== 'GAME_OVER') g.step(FIXED_DT);
  counting = false;
  check('S11 game-2 attempts ≥ 0.5 × game-1 attempts', `${count} vs ${g1}`, g1 > 0 && count >= 0.5 * g1, '≥ 0.5×');
}

// ------------------------------------------------------------------------------------------------ main
const t0 = Date.now();
if (BANDS.indexOf('A') >= 0) bandA();
if (BANDS.indexOf('B') >= 0) bandB();
if (BANDS.indexOf('C') >= 0) bandC();
const SC = { S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11 };
for (const s of SCENARIOS) if (SC[s]) SC[s]();
console.log(`\n${failures === 0 ? 'BALANCE OK' : 'BALANCE FAILED'}: ${checks - failures}/${checks} checks passed in ${((Date.now() - t0) / 1000).toFixed(1)} s${QUICK ? ' (--quick)' : ''}`);
process.exitCode = failures === 0 ? 0 : 1;
export { isThree };
