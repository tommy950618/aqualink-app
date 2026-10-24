#!/usr/bin/env node
/* Engine test harness (CONTRACT §6).
 *   node tools/test-engine.js            -> all tests + quick balance report
 *   node tools/test-engine.js --fast     -> smaller sample sizes
 *   node tools/test-engine.js --sim 4    -> also run N realistic-player progression simulations (per-chapter time report)
 *   node tools/test-engine.js --sim-only 8 [--afk 2] [--econ '{"coinsFirst":1.2}'] [--chp '[25000,…]'] [--sim-verbose]
 *                                        -> only the progression sims (econ / CH_END_POWER overrides for experiments)
 *   node tools/test-engine.js --calibrate 6 [--calib-n 120]  -> refit STAGE_ADJ (paste the printed block into engine.js)
 *   Performance: the battle-performance section prints ms per 5v5 simulate().
 * Loads core.js + every js/data/*.js (names starting with "_" skipped) + engine.js into a node vm with a
 * fake localStorage. Works with whatever data files exist: if a rarity has no characters yet, synthetic
 * "_fx_*" stand-ins are added (only for that rarity) so gacha tests stay meaningful.
 * Exit code 1 on any failed assertion.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.resolve(__dirname, '..');
var ROSTER = require('./roster.js');
var ARGS = process.argv.slice(2);
var FAST = ARGS.indexOf('--fast') >= 0;
var SIM_ONLY = ARGS.indexOf('--sim-only') >= 0;
var SIM_N = SIM_ONLY ? (parseInt(ARGS[ARGS.indexOf('--sim-only') + 1], 10) || 6) :
  ARGS.indexOf('--sim') >= 0 ? (parseInt(ARGS[ARGS.indexOf('--sim') + 1], 10) || 3) : 0;
var t0 = Date.now();
if (SIM_ONLY) { progressionSim(SIM_N); process.exit(0); }

/* ------------------------------------------------------------------ harness */
var passed = 0, failed = 0, warnings = [];
function ok(cond, msg) {
  if (cond) { passed++; return true; }
  failed++; console.log('  FAIL ' + msg); return false;
}
function eq(a, b, msg) { return ok(a === b, msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function near(a, b, tol, msg) { return ok(Math.abs(a - b) <= tol, msg + ' (got ' + a.toFixed(5) + ', want ' + b.toFixed(5) + ' ±' + tol + ')'); }
function section(name) { console.log('\n== ' + name); }
function finite(x) { return typeof x === 'number' && isFinite(x); }

/* ------------------------------------------------------------------ context */
function makeContext(opts) {
  opts = opts || {};
  var store = {};
  var warns = [];
  var ctx = {
    console: {
      log: function () { if (!opts.quiet) console.log.apply(console, arguments); },
      warn: function () { warns.push(Array.prototype.join.call(arguments, ' ')); },
      error: function () { console.error.apply(console, arguments); }
    },
    Math: Math, Date: Date, JSON: JSON
  };
  ctx.localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/core.js'), 'utf8'), ctx, { filename: 'core.js' });
  var files = fs.readdirSync(path.join(ROOT, 'js/data')).filter(function (f) { return /\.js$/.test(f) && f[0] !== '_'; }).sort();
  files.forEach(function (f) {
    try { vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/data', f), 'utf8'), ctx, { filename: f }); }
    catch (e) { console.log('  WARN data file ' + f + ' failed to load: ' + e.message); }
  });
  var realCount = ctx.NG.CHARS.length;
  var fixtures = addFixtures(ctx.NG);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/engine.js'), 'utf8'), ctx, { filename: 'engine.js' });
  ctx._store = store; ctx._warns = warns; ctx._files = files; ctx._real = realCount; ctx._fixtures = fixtures;
  return ctx;
}

/* synthetic stand-ins for rarities that have no real character yet */
function addFixtures(NG) {
  var have = {};
  NG.CHARS.forEach(function (c) { have[c.rarity] = true; });
  var list = [], k = 0;
  ['UR', 'SSR', 'SR', 'R'].forEach(function (r) {
    if (have[r]) return;
    for (var i = 0; i < 3; i++) {
      k++;
      list.push({
        id: '_fx_' + r.toLowerCase() + '_' + i, name: '测试忍者', form: r, en: 'Fixture', title: '测试', faction: 'other', rarity: r,
        role: ['atk', 'tank', 'heal'][i], element: ['fire', 'water', 'wind'][i], tags: ['输出'],
        stats: { hp: 1, atk: 1, def: 1, spd: 100 + i * 5 }, bio: '测试用角色，数据文件尚未到位。', quote: '测试', art: {},
        skills: {
          passive: { name: '被动', desc: '攻击力+10%。', tags: ['增益'], stats: { atk: 0.1 } },
          s1: { name: '攻击', desc: '造成100%攻击力伤害。', tags: ['输出'], fx: 'fist', target: 'single', cd: 0, effects: [{ type: 'dmg', mult: 1 }] },
          s2: { name: '技能', desc: '对全体造成80%攻击力伤害。', tags: ['群攻'], fx: 'fire', target: 'all', cd: 3, effects: [{ type: 'dmg', mult: 0.8 }] },
          ult: { name: '奥义', desc: '造成300%攻击力伤害并眩晕。', tags: ['爆发'], fx: 'bijuu', target: 'single', effects: [{ type: 'dmg', mult: 3 }, { type: 'status', status: 'stun', turns: 1, chance: 0.5 }] },
          awaken: { name: '突破', desc: '攻击力+12%，开场获得20查克拉。', tags: ['增益'], stats: { atk: 0.12 }, triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 20 }] }] }
        }
      });
    }
  });
  if (list.length) NG.defineChars('_fixtures', list);
  return list.length;
}

var ctx = makeContext({ quiet: true });
var NG = ctx.NG, G = NG.game, B = NG.battle;
var NOW = 1.8e12;
G._setClock(function () { return NOW; });
console.log('Loaded ' + ctx._real + ' real characters from ' + ctx._files.length + ' data file(s): ' + ctx._files.join(', ') +
  (ctx._fixtures ? '  (+' + ctx._fixtures + ' synthetic fixtures for missing rarities)' : ''));
var byRarity = { UR: [], SSR: [], SR: [], R: [] };
NG.CHARS.forEach(function (c) { if (byRarity[c.rarity]) byRarity[c.rarity].push(c.id); });
console.log('Pool: ' + Object.keys(byRarity).map(function (r) { return r + ' ' + byRarity[r].length; }).join(', '));

/* ------------------------------------------------------------------ 1. state */
section('new game state');
var S = G.init();
ok(S === G.state, 'init() returns state');
eq(S.v, 1, 'state.v');
eq(S.coins, 100000000, 'start coins 1亿');
eq(S.gems, 20000, 'start gems 2万');
eq(S.tickets, 1000, 'start tickets 1000');
eq(S.scrolls, 200, 'start scrolls 200');
eq(S.player.name, '无名忍者', 'player name');
eq(S.player.lv, 1, 'player lv');
ok(S.pity.ssr === 0 && S.pity.ur === 0 && S.totalPulls === 0, 'pity & pulls zero');
eq(S.flags.welcomed, false, 'flags.welcomed false');
ok(S.settings.speed === 1 && S.settings.auto === true && S.settings.rotate === 'auto' && S.settings.sound === false, 'default settings');
ok(Array.isArray(S.team) && S.team.length <= 5, 'team array');
S.team.forEach(function (id) { ok(!!S.roster[id] && !!NG.CHAR_MAP[id], 'starter ' + id + ' owned & defined'); });
ok(typeof ctx._store[NG.SAVE_KEY] === 'string', 'saved to localStorage');
ok(G.init() === S, 'init idempotent');
var events = [];
NG.on('change', function (d) { events.push(d && d.what); });
G.setSetting('speed', 2);
eq(G.state.settings.speed, 2, 'setSetting');
ok(events.indexOf('settings') >= 0, 'change event emitted for settings');
var saved = JSON.parse(ctx._store[NG.SAVE_KEY]);
eq(saved.settings.speed, 2, 'settings persisted');

/* reload from storage in a fresh engine instance sharing the same store */
(function () {
  var c2 = makeContext({ quiet: true });
  Object.keys(ctx._store).forEach(function (k) { c2._store[k] = ctx._store[k]; });
  var s2 = c2.NG.game.init();
  eq(s2.settings.speed, 2, 'save reloads in a new session');
  c2._store[c2.NG.SAVE_KEY] = '{corrupt';
  var c3 = makeContext({ quiet: true });
  c3._store[c3.NG.SAVE_KEY] = '{corrupt';
  var s3 = c3.NG.game.init();
  eq(s3.tickets, 1000, 'corrupt save → fresh state');
})();

/* ------------------------------------------------------------------ 2. gacha accounting */
section('summon accounting');
G.reset();
S = G.state;
eq(S.tickets, 1000, 'reset gives 1000 tickets again');
var r1 = G.summon(1);
ok(r1.ok && r1.results.length === 1, 'summon(1) ok, 1 result');
eq(G.state.tickets, 999, 'summon(1) spends 1 ticket');
var r10 = G.summon(10);
ok(r10.ok && r10.results.length === 10, 'summon(10) ok, 10 results');
eq(G.state.tickets, 989, 'summon(10) spends 10 tickets');
ok(r10.results.some(function (x) { return x.rarity === 'SSR' || x.rarity === 'UR'; }), '10-pull contains SSR+');
var r100 = G.summon(100);
ok(r100.ok && r100.results.length === 100, 'summon(100) ok, 100 results');
eq(G.state.tickets, 889, 'summon(100) spends 100 tickets');
eq(G.state.totalPulls, 111, 'totalPulls');
for (var b = 0; b < 10; b++) {
  ok(r100.results.slice(b * 10, b * 10 + 10).some(function (x) { return x.rarity === 'SSR' || x.rarity === 'UR'; }), '100-pull batch ' + b + ' has SSR+');
}
ok(!G.summon(5).ok && G.state.tickets === 889, 'summon(5) rejected without spending');
// isNew/shards bookkeeping
(function () {
  G.reset();
  var seen = {}, okAll = true;
  Object.keys(G.state.roster).forEach(function (id) { seen[id] = 1; });
  var shardsBefore = {};
  var res = G.summon(100).results;
  res.forEach(function (x) {
    var c = NG.CHAR_MAP[x.id];
    if (!c || c.rarity !== x.rarity) okAll = false;
    if (seen[x.id]) { if (x.isNew || x.shards !== NG.RARITIES[x.rarity].dupShards) okAll = false; }
    else { if (!x.isNew || x.shards !== 0) okAll = false; seen[x.id] = 1; }
  });
  ok(okAll, 'isNew / dupShards bookkeeping consistent');
  var total = 0; Object.keys(G.state.roster).forEach(function (id) { total += G.state.roster[id].shards; });
  var expect = res.reduce(function (a, x) { return a + x.shards; }, 0);
  eq(total, expect, 'roster shards equal granted dup shards');
  Object.keys(G.state.roster).forEach(function (id) { var e = G.state.roster[id]; if (!(e.lv === 1 && e.star === 1)) okAll = false; });
  ok(okAll, 'new characters start at Lv1 ★1');
  ok(G.state.team.length === Math.min(5, Object.keys(G.state.roster).length), 'team auto-filled after summon');
})();
// gems fallback
(function () {
  G.reset();
  G.state.tickets = 5; G.state.gems = 1000;
  var r = G.summon(10);
  ok(r.ok, 'summon(10) with 5 tickets + gems ok');
  eq(G.state.tickets, 0, 'tickets used first');
  eq(G.state.gems, 1000 - 5 * 150, 'remaining pulls paid with 150 gems each');
  var before = JSON.stringify([G.state.tickets, G.state.gems, G.state.totalPulls]);
  var r2 = G.summon(10);
  ok(!r2.ok && r2.reason, 'insufficient currency rejected: ' + r2.reason);
  eq(JSON.stringify([G.state.tickets, G.state.gems, G.state.totalPulls]), before, 'failed summon spends nothing');
})();

/* ------------------------------------------------------------------ 3. rates & pity */
section('rate distribution & pity');
(function () {
  var N = FAST ? 50000 : 200000;
  G.reset();
  var cnt = { UR: 0, SSR: 0, SR: 0, R: 0 }, gap = 0, maxGap = 0;
  for (var i = 0; i < N; i++) {
    G.state.tickets = 10; G.state.gems = 0;
    var x = G.summon(1).results[0];
    cnt[x.rarity]++;
    gap++;
    if (x.rarity === 'UR') { maxGap = Math.max(maxGap, gap); gap = 0; }
  }
  var rates = G.rates();
  eq(JSON.stringify(rates), JSON.stringify({ UR: 0.015, SSR: 0.085, SR: 0.3, R: 0.6 }), 'rates() from NG.RARITIES');
  // single pulls: base rates + hard UR pity at 90 → effective UR = 1/E[gap]
  var p = rates.UR, eg = (1 - Math.pow(1 - p, 90)) / p, pUR = 1 / eg;
  var rest = 1 - pUR, nonUR = rates.SSR + rates.SR + rates.R;
  var expect = { UR: pUR, SSR: rest * rates.SSR / nonUR, SR: rest * rates.SR / nonUR, R: rest * rates.R / nonUR };
  var tol = FAST ? 0.006 : 0.003;
  Object.keys(cnt).forEach(function (r) {
    near(cnt[r] / N, expect[r], r === 'UR' ? tol / 2 : tol * 1.5, r + ' single-pull rate over ' + N + ' pulls');
  });
  ok(maxGap <= 90, 'never more than 90 pulls between URs (max gap ' + maxGap + ')');
  // 10-pull mode rates (guarantee raises SSR+ a bit)
  G.reset();
  var c10 = { UR: 0, SSR: 0, SR: 0, R: 0 }, batches = 0, badBatch = 0;
  var M = FAST ? 200 : 2000;
  for (var j = 0; j < M; j++) {
    G.state.tickets = 100;
    var res = G.summon(100).results;
    for (var b2 = 0; b2 < 10; b2++) {
      batches++;
      var bt = res.slice(b2 * 10, b2 * 10 + 10);
      if (!bt.some(function (y) { return y.rarity === 'UR' || y.rarity === 'SSR'; })) badBatch++;
    }
    res.forEach(function (y) { c10[y.rarity]++; });
  }
  eq(badBatch, 0, 'every one of ' + batches + ' ten-pulls has SSR+');
  var ssrPlus = (c10.UR + c10.SSR) / (M * 100);
  ok(ssrPlus > 0.12 && ssrPlus < 0.16, '10-pull SSR+ rate in (12%,16%): ' + (ssrPlus * 100).toFixed(2) + '%');
  // explicit pity
  G.reset();
  G.state.pity.ur = 89;
  eq(G.summon(1).results[0].rarity, 'UR', '90th pull since last UR is UR');
  eq(G.pityInfo().ur, 0, 'UR pity resets');
  eq(G.pityInfo().urPity, 90, 'pityInfo.urPity');
})();

/* ------------------------------------------------------------------ 4. progression */
section('level / star / skill costs & caps');
(function () {
  G.reset();
  var id = G.state.team[0] || NG.CHARS[0].id;
  if (!G.owned(id)) { G.state.roster[id] = { lv: 1, star: 1, shards: 0, skills: { passive: 1, s1: 1, s2: 1, ult: 1, awaken: 1 }, obtained: 0 }; }
  var e = G.owned(id);
  eq(G.maxLevel(id), NG.STAR_LEVEL_CAP[1], 'maxLevel ★1');
  var c1 = G.levelCost(id, 1), c5 = G.levelCost(id, 5);
  ok(c1 > 0 && c5 > c1, 'levelCost positive & increasing');
  var sum = 0; for (var L = 1; L < 6; L++) sum += G.levelStepCost(L);
  eq(c5, sum, 'levelCost(5) = sum of step costs');
  var coins0 = G.state.coins, p0 = G.power(id);
  var r = G.levelUp(id, 5);
  ok(r.ok && r.gained === 5 && r.cost === c5, 'levelUp(5) ok');
  eq(G.state.coins, coins0 - c5, 'levelUp spends exact coins');
  eq(e.lv, 6, 'level is 6');
  ok(G.power(id) > p0, 'power grows with level');
  var big = G.levelUp(id, 10000);
  eq(e.lv, 100, 'levelUp clamps at ★1 cap');
  ok(!G.levelUp(id, 1).ok, 'cannot exceed cap');
  eq(G.levelCost(id, 10), 0, 'levelCost 0 at cap');
  // 1亿 levels roughly a full team of 5 to ~Lv100
  var team100 = G.levelCost('__none__', 99) * 5;
  ok(team100 > 0.7e8 && team100 <= 1.0e8, '5 × (Lv1→100) costs ' + NG.fmt(team100) + ' (≈ 1亿)');
  // coins insufficient
  var id2 = Object.keys(G.state.roster).filter(function (x) { return x !== id; })[0];
  if (id2) {
    G.state.coins = 10;
    var r2 = G.levelUp(id2, 1);
    ok(!r2.ok && r2.reason === '铜币不足' && G.owned(id2).lv === 1, 'levelUp without coins fails cleanly');
    G.state.coins = 1e12;
  }
  // stars
  eq(G.starCost(id), NG.STAR_SHARD_COST[1], 'starCost ★1→2');
  ok(!G.starUp(id).ok, 'starUp without shards fails');
  e.shards = 1000;
  var stars = [];
  while (G.starUp(id).ok) stars.push(e.star);
  eq(e.star, NG.MAX_STAR, 'stars up to MAX_STAR');
  eq(e.shards, 1000 - NG.STAR_SHARD_COST.slice(1).reduce(function (a, b) { return a + b; }, 0), 'shards spent exactly');
  eq(G.starCost(id), null, 'starCost null at max');
  eq(G.maxLevel(id), NG.STAR_LEVEL_CAP[NG.MAX_STAR], 'maxLevel at ★6');
  G.state.coins = 1e15;
  G.levelUp(id, 'max');
  eq(e.lv, NG.STAR_LEVEL_CAP[NG.MAX_STAR], 'levelUp("max") reaches cap');
  // skills
  var sc = G.skillCost(id, 's1');
  ok(sc && sc.coins > 0 && sc.scrolls > 0, 'skillCost has coins & scrolls');
  eq(G.skillValue(id, 's1'), 1, 'skillValue lv1 = 1');
  G.state.scrolls = 0;
  ok(!G.skillUp(id, 's1').ok, 'skillUp without scrolls fails');
  G.state.scrolls = 1e6;
  for (var k = 0; k < 20; k++) G.skillUp(id, 's1');
  eq(e.skills.s1, NG.MAX_SKILL_LV, 'skill capped at MAX_SKILL_LV');
  eq(G.skillCost(id, 's1'), null, 'skillCost null at max');
  near(G.skillValue(id, 's1'), 1 + 0.08 * (NG.MAX_SKILL_LV - 1), 1e-9, 'skillValue at max');
  ok(!G.skillUp(id, 'bogus').ok, 'unknown skill key rejected');
})();

section('awaken unlock');
(function () {
  G.reset();
  var cand = NG.CHARS.filter(function (c) { return c.skills && c.skills.awaken && c.skills.awaken.stats && Object.keys(c.skills.awaken.stats).length; })[0] || NG.CHARS[0];
  var id = cand.id;
  G.state.roster[id] = { lv: 1, star: 1, shards: 1000, skills: { passive: 1, s1: 1, s2: 1, ult: 1, awaken: 1 }, obtained: 0 };
  ok(!G.skillUnlocked(id, 'awaken'), 'awaken locked at ★1');
  ok(G.skillUnlocked(id, 'ult') && G.skillUnlocked(id, 'passive'), 'other skills unlocked');
  var r = G.skillUp(id, 'awaken');
  ok(!r.ok && /★/.test(r.reason), 'awaken skillUp blocked while locked: ' + r.reason);
  var e = G.owned(id);
  while (e.star < NG.AWAKEN_STAR - 1) G.starUp(id);
  var pBefore = G.stats(id).power, sBefore = G.stats(id);
  ok(!G.skillUnlocked(id, 'awaken'), 'awaken locked at ★' + (NG.AWAKEN_STAR - 1));
  var su = G.starUp(id);
  ok(su.ok && G.skillUnlocked(id, 'awaken'), 'awaken unlocked at ★' + NG.AWAKEN_STAR);
  var sAfter = G.stats(id);
  var starOnly = G.stats(id, { lv: 1, star: NG.AWAKEN_STAR, skills: e.skills });
  ok(sAfter.power > pBefore, 'power increases on awaken star');
  var hasAtk = cand.skills.awaken.stats && cand.skills.awaken.stats.atk > 0;
  if (hasAtk) {
    var ratio = sAfter.atk / sBefore.atk, starRatio = (1 + 0.15 * (NG.AWAKEN_STAR - 1)) / (1 + 0.15 * (NG.AWAKEN_STAR - 2));
    ok(ratio > starRatio * 1.01, 'awaken atk stat applied (' + cand.id + ')');
  }
  eq(JSON.stringify(starOnly), JSON.stringify(G.stats(id, { lv: 1, star: NG.AWAKEN_STAR, skills: e.skills })), 'stats() deterministic');
  ok(G.skillUp(id, 'awaken').ok, 'awaken skillUp works once unlocked');
  var z = G.stats('no_such_id');
  ok(z && z.power === 0, 'stats() of unknown id is zeroed, no throw');
})();

/* ------------------------------------------------------------------ 5. campaign */
section('campaign');
(function () {
  G.reset();
  var rosterIds = {}; ROSTER.forEach(function (r) { rosterIds[r.id] = r; });
  var raw = G._internal.CHAPTERS;
  eq(raw.length, 14, '14 chapters');
  var bad = [];
  raw.forEach(function (ch, ci) {
    ok(ch.s.length >= 8 && ch.s.length <= 10, 'chapter ' + (ci + 1) + ' has 8–10 stages (' + ch.s.length + ')');
    ch.s.forEach(function (st, si) {
      ok(st[2].length >= 1 && st[2].length <= 5, (ci + 1) + '-' + (si + 1) + ' 1–5 enemies');
      st[2].forEach(function (x) { var id = x.replace(/^!/, ''); if (!rosterIds[id]) bad.push((ci + 1) + '-' + (si + 1) + ':' + id); });
      ok(/[一-鿿]/.test(st[0]) && /[一-鿿]/.test(st[1]), (ci + 1) + '-' + (si + 1) + ' Chinese name & desc');
    });
  });
  eq(bad.join(','), '', 'every campaign enemy id is in tools/roster.js');
  var noBoruto = ['boruto', 'sarada', 'mitsuki', 'kawaki', 'momoshiki', 'kinshiki', 'toneri', 'himawari', 'code', 'eida'];
  var allIds = []; raw.forEach(function (ch) { ch.s.forEach(function (st) { allIds = allIds.concat(st[2]); }); });
  ok(!allIds.some(function (x) { return noBoruto.indexOf(x.replace(/^!/, '')) >= 0; }), 'no Boruto-era enemies');
  var chs = G.chapters(), bgs = ['city_night', 'village', 'forest', 'valley', 'desert', 'mist', 'rain', 'battlefield', 'summon', 'moon'];
  var total = 0, prevPower = 0, mono = true;
  chs.forEach(function (ch, ci) {
    ok(ch.id && ch.name && ch.desc && bgs.indexOf(ch.bg) >= 0, ch.id + ' shape & bg');
    ch.stages.forEach(function (st, si) {
      total++;
      ok(bgs.indexOf(st.bg) >= 0, st.id + ' bg valid');
      ok(st.enemies.length >= 1 && st.enemies.length <= 5, st.id + ' has 1–5 enemies');
      st.enemies.forEach(function (en) {
        ok(!!NG.CHAR_MAP[en.id], st.id + ' enemy ' + en.id + ' defined');
        ok(finite(en.lv) && en.lv >= 1 && en.lv <= 400 && en.star >= 1 && en.star <= 6, st.id + ' enemy lv/star in range');
      });
      var last = si === ch.stages.length - 1, bosses = st.enemies.filter(function (en) { return en.boss; });
      if (last) {
        ok(bosses.length === 1, st.id + ' boss stage has exactly one boss');
        var hm = bosses[0] ? bosses[0].hpMult : 0;
        ok(hm >= 2 && hm <= 3, st.id + ' boss hpMult in [2,3]: ' + hm);
      } else ok(bosses.length === 0, st.id + ' non-boss stage has no boss');
      ok(finite(st.power) && st.power > 0, st.id + ' power');
      if (st.power < prevPower * 0.97) mono = false;
      prevPower = st.power;
      ok(st.rewards.coins > 0 && st.firstRewards.coins > 0 && st.firstRewards.gems > 0 && st.firstRewards.tickets > 0, st.id + ' rewards incl. tickets/gems on first clear');
      var pv = G.enemyPreview(st.id);
      ok(pv.length === st.enemies.length && pv.every(function (x) { return x.c && x.c.id === x.id; }), st.id + ' enemyPreview');
    });
  });
  ok(total >= 112 && total <= 140, 'stage count ' + total);
  ok(mono, 'recommended power is (near) monotonic');
  var first = chs[0].stages[0].id, second = chs[0].stages[1].id;
  ok(G.stageState(first).unlocked && !G.stageState(second).unlocked, 'only first stage unlocked initially');
  eq(G.nextStage(), first, 'nextStage = first stage');
  // a strong team clears 1-1 and unlocks 1-2
  var ur = byRarity.UR[0] || NG.CHARS[0].id;
  G.state.roster[ur] = { lv: 100, star: 1, shards: 0, skills: { passive: 1, s1: 1, s2: 1, ult: 1, awaken: 1 }, obtained: 0 };
  G.setTeam([ur]);
  var rec = G.battleStage(first, 42);
  ok(rec && rec.stageId === first && rec.winner === 'A', 'battleStage 1-1 won by a Lv100 team');
  var coins0 = G.state.coins, tick0 = G.state.tickets;
  var fin = G.finishStage(first, rec);
  ok(fin.win && fin.firstClear && fin.stars >= 1, 'finishStage first clear');
  eq(G.state.coins - coins0, chs[0].stages[0].rewards.coins + chs[0].stages[0].firstRewards.coins, 'first clear grants rewards + firstRewards coins');
  eq(G.state.tickets - tick0, chs[0].stages[0].firstRewards.tickets, 'first clear grants tickets');
  ok(G.stageState(second).unlocked, 'next stage unlocked');
  eq(G.nextStage(), second, 'nextStage advances');
  var again = G.finishStage(first, rec);
  ok(!again.firstClear && Object.keys(again.rewards).length === 0, 'same record cannot be claimed twice');
  var rec2 = G.battleStage(first, 43), coins1 = G.state.coins;
  var fin2 = G.finishStage(first, rec2);
  ok(fin2.win && !fin2.firstClear && G.state.coins - coins1 === chs[0].stages[0].rewards.coins, 'repeat clear grants repeat rewards only');
  var lockedId = chs[5].stages[3].id, recL = G.battleStage(lockedId, 1);
  ok(recL && G.finishStage(lockedId, recL).win === false, 'locked stage grants nothing');
  ok(G.battleStage('99-99') === null && G.finishStage('99-99', rec).win === false, 'unknown stage handled');
  var lose = { winner: 'B', stars: 0, stageId: second };
  var fl = G.finishStage(second, lose);
  ok(!fl.win && fl.stars === 0 && !G.stageState(second).cleared, 'loss grants nothing');
  // AFK
  var idle0 = G.idle();
  ok(idle0.seconds === 0 || idle0.seconds >= 0, 'idle() shape');
  NOW += 3600 * 1000;
  var i1 = G.idle();
  eq(i1.seconds, 3600, 'idle seconds after 1h');
  ok(i1.coins > 0 && i1.exp > 0 && i1.scrolls > 0, 'idle accrues coins/exp/scrolls');
  ok([i1.gems, i1.tickets].every(function (v) { return finite(v) && v >= 0 && v === Math.floor(v); }), 'idle() also reports whole gems/tickets');
  NOW += 48 * 3600 * 1000;
  var i12 = G.idle();
  eq(i12.seconds, 12 * 3600, 'idle capped at 12h');
  ok(i12.gems > 0 && i12.tickets >= 1, 'a full 12h chest holds gems and at least one ticket (' + i12.gems + ' gems, ' + i12.tickets + ' tickets)');
  var rt = G.idleRate();
  ok(i12.gems <= Math.ceil(rt.gems * 12) && i12.tickets <= Math.ceil(rt.tickets * 12), 'gems/tickets also respect the 12h cap');
  var c2 = G.state.coins, g2 = G.state.gems, t2 = G.state.tickets, cl = G.claimIdle();
  ok(cl.ok && G.state.coins - c2 === cl.coins, 'claimIdle grants coins');
  ok(G.state.gems - g2 === cl.gems && G.state.tickets - t2 === cl.tickets && cl.gems === i12.gems && cl.tickets === i12.tickets, 'claimIdle grants the previewed gems/tickets');
  eq(G.idle().seconds, 0, 'claimIdle resets timer');
  ok(G.idle().gems === 0 && G.idle().tickets === 0, 'nothing pending right after claiming');
  // fractional gems/tickets carry over: 72 claims every 10 min pay the same as one 12h claim
  G.state.idleFrac = { gems: 0, tickets: 0 };
  var gA = G.state.gems, tA = G.state.tickets;
  for (var ci = 0; ci < 72; ci++) { NOW += 600 * 1000; G.claimIdle(); }
  var gotFreq = [G.state.gems - gA, G.state.tickets - tA];
  G.state.idleFrac = { gems: 0, tickets: 0 };
  NOW += 12 * 3600 * 1000;
  var one = G.claimIdle();
  ok(Math.abs(gotFreq[0] - one.gems) <= 1 && Math.abs(gotFreq[1] - one.tickets) <= 1, 'frequent claims lose no gems/tickets (10-min claims ' + gotFreq.join('/') + ' vs one 12h claim ' + one.gems + '/' + one.tickets + ')');
  var fr = G.state.idleFrac;
  ok(fr && fr.gems >= 0 && fr.gems < 1 && fr.tickets >= 0 && fr.tickets < 1, 'idleFrac remainder stays in [0,1)');
  // enemies whose data is missing are filtered out (a stage left empty gets deterministic stand-ins)
  var cm = makeContext({ quiet: true }), N2 = cm.NG;
  ['manda', 'gamabunta'].forEach(function (id) { var c = N2.CHAR_MAP[id]; if (c) { N2.CHARS.splice(N2.CHARS.indexOf(c), 1); delete N2.CHAR_MAP[id]; } });
  var s48 = N2.game.stage('4-8'), s28 = N2.game.stage('2-8');
  ok(s48 && s48.enemies.length === 2 && s48.enemies.every(function (e) { return N2.CHAR_MAP[e.id]; }) && s48.enemies.some(function (e) { return e.boss; }), 'missing enemy ids are filtered out of a lineup');
  ok(s28 && s28.enemies.length >= 1 && s28.enemies.every(function (e) { return N2.CHAR_MAP[e.id]; }), 'a stage whose enemies are all missing gets stand-ins');
  ok(N2.game.battleStage('4-8', 1).winner !== undefined, 'filtered stage still battles');
  // old saves from before a stage was inserted: gaps in front of the frontier are filled on load
  var cg = makeContext({ quiet: true }), sv = JSON.parse(ctx._store[NG.SAVE_KEY]);
  sv.progress = { '1-1': 3, '1-2': 2, '1-4': 3, '1-5': 1 };
  cg._store[cg.NG.SAVE_KEY] = JSON.stringify(sv);
  var sg = cg.NG.game.init();
  ok(sg.progress['1-3'] === 1 && sg.progress['1-4'] === 3 && !sg.progress['1-6'], 'progress gaps from older stage layouts are filled (1★) on load');
  eq(cg.NG.game.nextStage(), '1-6', 'nextStage after gap fill is the real frontier');
  var rateEarly = G.idleRate();
  chs.slice(0, 6).forEach(function (ch) { ch.stages.forEach(function (st) { G.state.progress[st.id] = 3; }); });
  var rateMid = G.idleRate();
  ok(rateMid.coins > rateEarly.coins, 'idle rate scales with progress');
  ok(rateMid.gems > rateEarly.gems && rateMid.tickets > rateEarly.tickets, 'idle gems/tickets scale with progress');
  chs.forEach(function (ch) { ch.stages.forEach(function (st) { G.state.progress[st.id] = 3; }); });
  var rateEnd = G.idleRate(), pulls12 = rateEnd.tickets * 12 + rateEnd.gems * 12 / G.cfg.gemsPerPull;
  ok(pulls12 >= 8 && pulls12 <= 12, 'late-game 12h chest ≈ 10 pulls of gems + tickets (got ' + pulls12.toFixed(1) + ')');
  ok(rateEarly.tickets * 12 + rateEarly.gems * 12 / G.cfg.gemsPerPull < 4, 'early-game AFK pulls stay small');
  // a corrupt idleFrac in a save is clamped on load
  var cf = makeContext({ quiet: true }), svf = JSON.parse(ctx._store[NG.SAVE_KEY]);
  svf.idleFrac = { gems: 5, tickets: 'x' };
  cf._store[cf.NG.SAVE_KEY] = JSON.stringify(svf);
  var sf = cf.NG.game.init();
  ok(sf.idleFrac && sf.idleFrac.gems < 1 && sf.idleFrac.gems >= 0 && sf.idleFrac.tickets === 0, 'corrupt idleFrac is clamped on load');
})();

/* ------------------------------------------------------------------ 6. battle determinism & events */
section('battle determinism & event format');
var KNOWN_T = ['round', 'act', 'dmg', 'miss', 'heal', 'shield', 'status', 'status_end', 'chakra', 'skip', 'passive', 'death', 'revive', 'end'];
function rng(seed) { return B.rng(seed); }
function pickN(arr, n, R) { var a = arr.slice(), o = []; while (o.length < n && a.length) o.push(a.splice(Math.floor(R() * a.length), 1)[0]); return o; }
function starFor(lv) { var caps = NG.STAR_LEVEL_CAP; for (var s = 1; s < caps.length; s++) if (caps[s] >= lv) return s; return caps.length - 1; }
function entry(id, lv, star, sk) { return { id: id, lv: lv, star: star || starFor(lv), skills: { passive: sk || 1, s1: sk || 1, s2: sk || 1, ult: sk || 1, awaken: sk || 1 } }; }

function checkRecord(rec, label, stats) {
  var errs = [];
  if (!rec || !Array.isArray(rec.events) || !Array.isArray(rec.units)) return ['no record'];
  var uids = {}, hp = {}, sh = {}, maxHp = {}, alive = {};
  rec.units.forEach(function (u) {
    uids[u.uid] = u; hp[u.uid] = u.hp; sh[u.uid] = 0; maxHp[u.uid] = u.maxHp; alive[u.uid] = true;
    ['maxHp', 'hp', 'lv', 'star', 'pos', 'chakra'].forEach(function (k) { if (!finite(u[k])) errs.push('unit ' + u.uid + '.' + k + ' not finite'); });
    if (u.hp !== u.maxHp) errs.push('unit ' + u.uid + ' does not start at full hp');
  });
  if (!(rec.winner === 'A' || rec.winner === 'B')) errs.push('bad winner');
  if (!(rec.rounds >= 1 && rec.rounds <= 30)) errs.push('rounds out of range ' + rec.rounds);
  if (rec.winner === 'A' && !(rec.stars >= 1 && rec.stars <= 3)) errs.push('bad stars');
  var last = rec.events[rec.events.length - 1];
  if (!last || last.t !== 'end' || last.winner !== rec.winner) errs.push('last event must be end');
  var lastRound = 0, curActor = null;
  rec.events.forEach(function (e, i) {
    if (KNOWN_T.indexOf(e.t) < 0) errs.push('unknown event t ' + e.t);
    Object.keys(e).forEach(function (k) { if (typeof e[k] === 'number' && !isFinite(e[k])) errs.push('non-finite ' + e.t + '.' + k); });
    if (e.uid !== undefined && !uids[e.uid]) errs.push('unknown uid ' + e.uid + ' in ' + e.t);
    if (e.src !== undefined && e.src !== null && !uids[e.src]) errs.push('unknown src ' + e.src);
    switch (e.t) {
      case 'round': if (e.n !== lastRound + 1) errs.push('round not consecutive'); lastRound = e.n; break;
      case 'act':
        curActor = e.uid;
        if (['s1', 's2', 'ult'].indexOf(e.skill) < 0) errs.push('bad act.skill');
        if (!NG.FX[e.fx]) errs.push('bad act.fx ' + e.fx);
        if (!Array.isArray(e.targets) || e.targets.some(function (x) { return !uids[x]; })) errs.push('bad act.targets');
        if (!alive[e.uid]) errs.push('dead unit acted ' + e.uid);
        if (stats) { stats.acts++; if (e.skill === 'ult') stats.ults++; }
        break;
      case 'dmg':
        if (!(e.amount > 0)) errs.push('dmg amount not positive');
        if (['hit', 'dot', 'counter', 'execute', 'true'].indexOf(e.kind) < 0) errs.push('bad dmg.kind ' + e.kind);
        var ab = e.absorbed || 0;
        if (ab > sh[e.uid] + 1) errs.push('absorbed more than shield');
        var expHp = Math.max(0, hp[e.uid] - (e.amount - ab));
        if (expHp !== e.hp) errs.push('hp replay mismatch at #' + i + ' ' + hp[e.uid] + '-' + e.amount + '+' + ab + ' != ' + e.hp);
        if (sh[e.uid] - ab !== e.shield) errs.push('shield replay mismatch at #' + i);
        hp[e.uid] = e.hp; sh[e.uid] = e.shield;
        if (!alive[e.uid]) errs.push('damage to dead unit');
        if (stats) { stats.dmg++; if (e.crit) stats.crit++; stats.maxHit = Math.max(stats.maxHit, e.amount / maxHp[e.uid]); }
        break;
      case 'heal':
        if (!(e.amount > 0)) errs.push('heal amount not positive');
        if (hp[e.uid] + e.amount !== e.hp) errs.push('heal replay mismatch');
        if (e.hp > maxHp[e.uid]) errs.push('overheal');
        hp[e.uid] = e.hp; break;
      case 'shield':
        if (sh[e.uid] + e.amount !== e.shield) errs.push('shield event mismatch at #' + i + ' ' + sh[e.uid] + '+' + e.amount + '!=' + e.shield);
        if (e.shield < 0) errs.push('negative shield');
        sh[e.uid] = e.shield; break;
      case 'chakra': if (!(e.chakra >= 0 && e.chakra <= 100)) errs.push('chakra out of range'); break;
      case 'status': if (typeof e.status !== 'string' || !(e.turns >= 1)) errs.push('bad status event'); break;
      case 'status_end': if (typeof e.status !== 'string') errs.push('bad status_end'); break;
      case 'skip': if (!NG.STATUSES[e.status]) errs.push('bad skip.status'); if (stats) stats.skips++; break;
      case 'death': if (hp[e.uid] !== 0) errs.push('death with hp>0'); alive[e.uid] = false; sh[e.uid] = 0; break;
      case 'revive': if (alive[e.uid]) errs.push('revive of living unit'); alive[e.uid] = true; hp[e.uid] = e.hp; sh[e.uid] = 0; if (stats) stats.revives++; break;
      case 'passive': if (typeof e.name !== 'string') errs.push('passive without name'); if (stats) stats.passives++; break;
    }
  });
  var aliveA = rec.units.some(function (u) { return u.side === 'A' && alive[u.uid]; });
  var aliveB = rec.units.some(function (u) { return u.side === 'B' && alive[u.uid]; });
  if (rec.winner === 'A' && aliveB) errs.push('A won but B alive');
  if (rec.winner === 'B' && !rec.timeout && aliveB === false && aliveA) errs.push('B won without timeout while A alive');
  return errs.map(function (x) { return label + ': ' + x; });
}

(function () {
  var all = NG.CHARS.map(function (c) { return c.id; });
  var R = rng(5);
  var A = pickN(all, 5, R).map(function (id) { return entry(id, 120); });
  var Bt = pickN(all, 5, R).map(function (id) { return entry(id, 120); });
  var r1 = B.simulate(A, Bt, { seed: 12345 }), r2 = B.simulate(A, Bt, { seed: 12345 }), r3 = B.simulate(A, Bt, { seed: 54321 });
  eq(JSON.stringify(r1), JSON.stringify(r2), 'same seed → identical record');
  ok(JSON.stringify(r1.events) !== JSON.stringify(r3.events), 'different seed → different events');
  eq(r1.seed, 12345, 'record.seed');
  var e1 = checkRecord(r1, 'det');
  ok(e1.length === 0, 'record passes format checks' + (e1.length ? ': ' + e1.slice(0, 5).join(' | ') : ''));
  ok(r1.units.length === A.length + Bt.length && r1.units[0].uid === 'A0' && r1.units[A.length].uid === 'B0', 'unit uids A0.. / B0..');
  var bs = G.battleStage(G.chapters()[0].stages[0].id, 7), bs2 = G.battleStage(G.chapters()[0].stages[0].id, 7);
  eq(JSON.stringify(bs.events), JSON.stringify(bs2.events), 'battleStage deterministic with seed');
  var empty = B.simulate([], Bt, { seed: 1 });
  ok(empty.winner === 'B' && checkRecord(empty, 'empty').length === 0, 'empty team A loses gracefully');
  var unknown = B.simulate([{ id: 'nobody', lv: 10 }].concat(A.slice(0, 2)), [{ id: 'ghost' }].concat(Bt.slice(0, 2)), { seed: 3 });
  ok(unknown.units.length === 4, 'unknown ids skipped in battle');
  // unknown vocabulary never throws, warns once
  var weird = JSON.parse(JSON.stringify(NG.CHAR_MAP[all[0]]));
  weird.id = '_weird'; weird.skills.s1 = { name: '怪', fx: 'nope', target: 'sideways', effects: [{ type: 'teleport' }, { type: 'dmg', mult: 1, to: 'moon' }, { type: 'buff', stat: 'luck', value: 0.2 }, { type: 'status', status: 'confuse' }] };
  weird.skills.passive = { name: '怪', stats: { charisma: 1 }, triggers: [{ on: 'on_sneeze', effects: [{ type: 'heal', pct: 0.1 }] }] };
  NG.defineChars('_weird', [weird]);
  var warns0 = ctx._warns.length, threw = false, rw;
  try { rw = B.simulate([entry('_weird', 50), entry('_weird', 50)], Bt, { seed: 9 }); B.simulate([entry('_weird', 50)], Bt, { seed: 10 }); } catch (e) { threw = e; }
  ok(!threw, 'unknown effect/target/stat/status/trigger values do not throw' + (threw ? ': ' + threw.stack : ''));
  ok(rw && checkRecord(rw, 'weird').length === 0, 'weird record still well-formed');
  var newWarns = ctx._warns.slice(warns0);
  ok(newWarns.length >= 5, 'unknown values are warned (' + newWarns.length + ' warnings)');
  var dup = {}; newWarns.forEach(function (w) { dup[w] = (dup[w] || 0) + 1; });
  ok(Object.keys(dup).every(function (k) { return dup[k] === 1; }), 'each unknown value warned only once');
  NG.CHARS.splice(NG.CHARS.indexOf(NG.CHAR_MAP._weird), 1); delete NG.CHAR_MAP._weird;
})();

/* ------------------------------------------------------------------ 6b. mechanics (crafted characters) */
section('battle mechanics');
(function () {
  var made = [];
  function def(id, o) {
    var c = {
      id: id, name: '机制' + id, form: '', en: id, title: 't', faction: 'other', rarity: o.rarity || 'SR', role: o.role || 'ctrl',
      element: o.element || 'none', tags: ['输出'], stats: { hp: 1, atk: 1, def: 1, spd: o.spd || 100 }, bio: '机制测试角色，仅用于测试。', quote: 'q', art: {},
      skills: {
        passive: o.passive || { name: '被动' + id, stats: { hp: 0 } },
        s1: o.s1 || { name: '普攻', fx: 'fist', target: 'single', cd: 0, effects: [{ type: 'dmg', mult: 1 }] },
        s2: o.s2 === undefined ? null : o.s2,
        ult: o.ult === undefined ? null : o.ult,
        awaken: o.awaken || { name: '突破', stats: { atk: 0.1 } }
      }
    };
    if (!c.skills.s2) delete c.skills.s2;
    if (!c.skills.ult) delete c.skills.ult;
    made.push(c);
    return id;
  }
  var noop = { name: '静', fx: 'shield', target: 'self', cd: 0, effects: [{ type: 'buff', stat: 'def', value: 0.01, turns: 1 }] };
  function bs(effects) { return { name: '开场', triggers: [{ on: 'battle_start', effects: effects }] }; }
  def('m_dummy', { spd: 100, s1: noop });
  def('m_hitter', { spd: 150 });
  def('m_sniper', { spd: 150, s1: { name: '狙', fx: 'shuriken', target: 'lowest', cd: 0, effects: [{ type: 'dmg', mult: 1 }] } });
  def('m_slow', { spd: 60 });
  def('m_taunt', { spd: 90, s1: noop, passive: bs([{ type: 'taunt', turns: 3 }]) });
  def('m_shield', { spd: 90, s1: noop, passive: bs([{ type: 'shield', pct: 0.5, turns: 3 }]) });
  def('m_burner', { spd: 200, s1: noop, passive: bs([{ type: 'status', status: 'burn', turns: 2, value: 0.3, to: 'enemy_all' }]) });
  def('m_buffself', { spd: 100, s1: noop, passive: bs([{ type: 'buff', stat: 'atk', value: 0.3, turns: 2 }]) });
  def('m_stunner', { spd: 200, s1: noop, passive: bs([{ type: 'status', status: 'stun', turns: 1, to: 'enemy_all' }]) });
  def('m_sleeper', { spd: 200, s1: { name: '击', fx: 'fist', target: 'single', cd: 0, effects: [{ type: 'dmg', mult: 0.2 }] }, passive: bs([{ type: 'status', status: 'sleep', turns: 3, to: 'enemy_all' }]) });
  def('m_silencer', { spd: 200, s1: noop, passive: bs([{ type: 'status', status: 'silence', turns: 3, to: 'enemy_all' }]) });
  def('m_caster', { spd: 100, passive: bs([{ type: 'chakra', value: 100 }]),
    s2: { name: '二', fx: 'fire', target: 'single', cd: 3, effects: [{ type: 'dmg', mult: 1 }] },
    ult: { name: '奥', fx: 'bijuu', target: 'single', effects: [{ type: 'dmg', mult: 1 }] } });
  def('m_glass', { spd: 50, s1: noop, rarity: 'R' });
  def('m_reviver', { spd: 60, s1: noop, passive: { name: '复苏', triggers: [{ on: 'on_ally_death', effects: [{ type: 'revive', pct: 0.5 }] }] } });
  def('m_counter', { spd: 90, s1: noop, passive: bs([{ type: 'counter', mult: 0.5, turns: 5 }]) });
  def('m_vamp', { spd: 50, s1: { name: '吸', fx: 'fist', target: 'single', cd: 0, effects: [{ type: 'dmg', mult: 1 }, { type: 'lifesteal', value: 0.5 }] } });
  def('m_exec', { spd: 100, s1: { name: '斩', fx: 'blade', target: 'single', cd: 0, effects: [{ type: 'dmg', mult: 0.1 }, { type: 'execute', threshold: 0.99, mult: 1 }] } });
  def('m_fire', { spd: 100, element: 'fire' });
  def('m_wind', { spd: 50, element: 'wind', s1: noop });
  def('m_water', { spd: 100, element: 'water' });
  def('m_true', { spd: 100, s1: { name: '真', fx: 'eye', target: 'single', cd: 0, effects: [{ type: 'true_dmg', pct: 0.1 }] } });
  def('m_crit', { spd: 100, passive: { name: '必暴', stats: { crit: 1 } } });
  def('m_drain', { spd: 100, s1: { name: '吸能', fx: 'chakra', target: 'single', cd: 0, effects: [{ type: 'drain', value: 30 }] } });
  def('m_immune', { spd: 250, s1: noop, passive: bs([{ type: 'immune', turns: 3 }]) });
  def('m_s2', { spd: 100, s2: { name: '二', fx: 'fire', target: 'single', cd: 3, effects: [{ type: 'dmg', mult: 0.1 }] }, s1: { name: '一', fx: 'fist', target: 'single', cd: 0, effects: [{ type: 'dmg', mult: 0.1 }] } });
  def('m_tank', { spd: 100, s1: { name: '疗', fx: 'heal', target: 'self', cd: 0, effects: [{ type: 'heal', pct: 1 }] }, passive: { name: '硬', stats: { dr: 0.6 } } });
  def('m_cleanser', { spd: 150, s1: { name: '净', fx: 'heal', target: 'ally_all', cd: 0, effects: [{ type: 'cleanse', to: 'ally_all' }] } });
  def('m_dispeller', { spd: 150, s1: { name: '驱', fx: 'seal', target: 'single', cd: 0, effects: [{ type: 'dispel' }] } });
  NG.defineChars('_mech', made);
  function E(id, lv) { return entry(id, lv || 50, 1, 1); }
  function sim(a, b, seed) { var r = B.simulate(a, b, { seed: seed || 1 }); var er = checkRecord(r, 'mech'); if (er.length) ok(false, er.slice(0, 3).join(' | ')); return r; }
  function evs(r, pred) { return r.events.filter(pred); }

  // taunt redirects single-target skills
  var r = sim([E('m_dummy'), E('m_taunt')], [E('m_hitter')]);
  var firstAct = evs(r, function (e) { return e.t === 'act' && e.uid === 'B0'; })[0];
  ok(firstAct && firstAct.targets[0] === 'A1', 'taunt: single-target skill forced onto the taunter (A1)');
  // shields absorb first
  r = sim([E('m_shield')], [E('m_hitter')]);
  var d1 = evs(r, function (e) { return e.t === 'dmg' && e.uid === 'A0'; })[0];
  ok(d1 && d1.absorbed === d1.amount && d1.hp === r.units[0].maxHp, 'shield absorbs damage before HP');
  // DoT ticks at owner's turn start; durations count owner turns
  r = sim([E('m_dummy', 50)], [E('m_burner', 50)]);
  var ticks = evs(r, function (e) { return e.t === 'dmg' && e.kind === 'dot' && e.uid === 'A0'; });
  eq(ticks.length, 2, 'burn 2 turns ticks exactly twice');
  var idxTick = r.events.indexOf(ticks[0]), nextAct = r.events.slice(idxTick).filter(function (e) { return e.t === 'act'; })[0];
  ok(nextAct && nextAct.uid === 'A0', 'DoT ticks right before the owner acts (turn start)');
  ok(Math.abs(ticks[0].amount - Math.round(0.3 * r.units[1].atk)) <= 1, 'burn tick = value × caster ATK (' + ticks[0].amount + ')');
  // buff durations decrement at owner's turn end (self buff lasts 2 own turns)
  r = sim([E('m_buffself', 50)], [E('m_slow', 1)]);
  var acts = r.events.map(function (e, i) { return e.t === 'act' && e.uid === 'A0' ? i : -1; }).filter(function (i) { return i >= 0; });
  var endIdx = r.events.findIndex(function (e) { return e.t === 'status_end' && e.uid === 'A0' && e.status === 'buff:atk'; });
  ok(endIdx > acts[1] && (acts.length < 3 || endIdx < acts[2]), 'buff turns:2 expires after the owner\'s 2nd turn');
  // control → skip
  r = sim([E('m_dummy', 50)], [E('m_stunner', 50)]);
  var aEv = evs(r, function (e) { return (e.t === 'act' || e.t === 'skip') && e.uid === 'A0'; });
  ok(aEv[0] && aEv[0].t === 'skip' && aEv[0].status === 'stun' && aEv[1] && aEv[1].t === 'act', 'stun 1: loses exactly one turn');
  // sleep breaks on damage
  r = sim([E('m_dummy', 50)], [E('m_sleeper', 50)]);
  var slEnd = r.events.findIndex(function (e) { return e.t === 'status_end' && e.uid === 'A0' && e.status === 'sleep'; });
  var firstHit = r.events.findIndex(function (e) { return e.t === 'dmg' && e.uid === 'A0'; });
  ok(slEnd > 0 && slEnd === firstHit + 1, 'sleep breaks on the first damage');
  // silence → s1 only (even with full chakra and s2 ready)
  r = sim([E('m_caster', 50)], [E('m_silencer', 50)]);
  var cAct = evs(r, function (e) { return e.t === 'act' && e.uid === 'A0'; });
  ok(cAct[0] && cAct[0].skill === 's1', 'silenced unit uses s1 only');
  ok(cAct.some(function (e) { return e.skill === 'ult'; }), 'ult used once silence ends');
  r = sim([E('m_caster', 50)], [E('m_dummy', 50)]);
  var u0 = evs(r, function (e) { return e.t === 'act' && e.uid === 'A0'; });
  eq(u0[0].skill, 'ult', 'chakra 100 → ult first');
  var chAfterUlt = r.events.slice(r.events.indexOf(u0[0])).filter(function (e) { return e.t === 'chakra' && e.uid === 'A0'; });
  eq(r.events[r.events.indexOf(u0[0]) - 1].t === 'chakra' && r.events[r.events.indexOf(u0[0]) - 1].chakra, 0, 'ult resets chakra to 0');
  eq(u0[1].skill, 's2', 's2 used when off cooldown');
  ok(u0[2].skill === 's1' && u0[3].skill === 's1' && u0[4].skill === 's2', 's2 cd 3 → used every 3rd turn');
  var hitChakra = evs(r, function (e) { return e.t === 'chakra' && e.uid === 'B0'; });
  eq(hitChakra[0] && hitChakra[0].chakra, 10, '+10 chakra when hit');
  var actChakra = r.events.slice(r.events.indexOf(u0[1])).filter(function (e) { return e.t === 'chakra' && e.uid === 'A0'; })[0];
  eq(actChakra && actChakra.chakra, 25, '+25 chakra per action');
  // revive once per caster
  r = sim([E('m_glass', 1), E('m_reviver', 400)], [E('m_sniper', 300)]);
  eq(evs(r, function (e) { return e.t === 'revive'; }).length, 1, 'revive happens once per caster');
  ok(evs(r, function (e) { return e.t === 'death' && e.uid === 'A0'; }).length === 2, 'revived unit can die again');
  // counter
  r = sim([E('m_counter', 50)], [E('m_hitter', 50)]);
  var ct = evs(r, function (e) { return e.t === 'dmg' && e.kind === 'counter'; })[0];
  ok(ct && ct.src === 'A0' && ct.uid === 'B0', 'counter strikes the attacker');
  // lifesteal
  r = sim([E('m_vamp', 50)], [E('m_hitter', 50)]);
  var vAct = r.events.findIndex(function (e) { return e.t === 'act' && e.uid === 'A0'; });
  var vHeal = r.events.slice(vAct).filter(function (e) { return e.t === 'heal' && e.uid === 'A0'; })[0];
  var vDmg = r.events.slice(vAct).filter(function (e) { return e.t === 'dmg' && e.src === 'A0'; })[0];
  ok(vHeal && Math.abs(vHeal.amount - Math.round(vDmg.amount * 0.5)) <= 1, 'lifesteal heals 50% of damage dealt');
  // execute
  r = sim([E('m_exec', 50)], [E('m_dummy', 50)]);
  ok(evs(r, function (e) { return e.t === 'dmg' && e.kind === 'execute'; }).length > 0, 'execute fires below threshold');
  // element advantage
  r = sim([E('m_fire', 50)], [E('m_wind', 50)]);
  var fd = evs(r, function (e) { return e.t === 'dmg' && e.src === 'A0'; });
  ok(fd.length && fd.every(function (e) { return e.adv === true && e.el === 'fire'; }), 'fire beats wind → adv:true');
  r = sim([E('m_water', 50)], [E('m_wind', 50)]);
  ok(evs(r, function (e) { return e.t === 'dmg' && e.src === 'A0'; }).every(function (e) { return !e.adv; }), 'water vs wind → no advantage');
  // true damage, bosses take 30%
  r = sim([E('m_true', 50)], [E('m_dummy', 50)]);
  var t1 = evs(r, function (e) { return e.t === 'dmg' && e.kind === 'true'; })[0];
  var bossE = E('m_dummy', 50); bossE.boss = true; bossE.hpMult = 2;
  var rb = sim([E('m_true', 50)], [bossE]);
  var t2 = evs(rb, function (e) { return e.t === 'dmg' && e.kind === 'true'; })[0];
  ok(t1 && Math.abs(t1.amount - Math.round(0.1 * r.units[1].maxHp)) <= 1, 'true_dmg = pct × max HP');
  ok(t2 && Math.abs(t2.amount - Math.round(0.1 * rb.units[1].maxHp * 0.3)) <= 1, 'boss takes 30% of true_dmg');
  eq(rb.units[1].maxHp, r.units[1].maxHp * 2, 'boss hpMult applied to max HP');
  // crit
  r = sim([E('m_crit', 50)], [E('m_dummy', 50)]);
  ok(evs(r, function (e) { return e.t === 'dmg' && e.src === 'A0'; }).every(function (e) { return e.crit; }), 'crit 100% → every hit crits');
  // drain
  r = sim([E('m_drain', 50)], [E('m_caster', 50)]);
  var drained = r.events.findIndex(function (e) { return e.t === 'act' && e.uid === 'A0'; });
  var dc = r.events.slice(drained).filter(function (e) { return e.t === 'chakra' && e.uid === 'B0'; })[0];
  ok(dc && dc.chakra < 100, 'drain removes chakra');
  // immune
  r = sim([E('m_immune', 50)], [E('m_stunner', 50)]);
  ok(!evs(r, function (e) { return e.t === 'skip' && e.uid === 'A0'; }).length, 'immune blocks control');
  // cleanse & dispel
  r = sim([E('m_cleanser', 50), E('m_dummy', 50)], [E('m_silencer', 50)]);
  ok(evs(r, function (e) { return e.t === 'status_end' && e.status === 'silence'; }).length >= 1, 'cleanse removes silence');
  r = sim([E('m_dispeller', 50)], [E('m_shield', 50)]);
  ok(evs(r, function (e) { return e.t === 'shield' && e.uid === 'B0' && e.shield === 0; }).length >= 1, 'dispel removes shields');
  // stalemate → max rounds → B wins
  r = sim([E('m_tank', 400)], [E('m_tank', 400)]);
  ok(r.winner === 'B' && r.timeout && r.rounds === 30, 'max 30 rounds, timeout counts as B');
  // speed: faster unit acts more often
  r = sim([E('m_hitter', 1)], [E('m_tank', 400)]);
  var ha = evs(r, function (e) { return e.t === 'act' && e.uid === 'A0'; }).length, ta = evs(r, function (e) { return e.t === 'act' && e.uid === 'B0'; }).length;
  ok(ha > ta * 1.3, 'ATB: spd 150 acts ~1.5× as often as spd 100 (' + ha + ' vs ' + ta + ')');
  // stars: 3 = no deaths
  r = sim([E('m_hitter', 300), E('m_hitter', 300)], [E('m_glass', 1)]);
  ok(r.winner === 'A' && r.stars === 3, '3 stars without deaths');
  made.forEach(function (c) { NG.CHARS.splice(NG.CHARS.indexOf(c), 1); delete NG.CHAR_MAP[c.id]; });
})();

/* ------------------------------------------------------------------ 7. fuzz */
section('fuzz: every character in random 5v5 battles');
var fuzzStats = { battles: 0, acts: 0, ults: 0, dmg: 0, crit: 0, skips: 0, revives: 0, passives: 0, rounds: 0, timeouts: 0, maxHit: 0, roundsList: [] };
(function () {
  var all = NG.CHARS.map(function (c) { return c.id; });
  var used = {}, errs = [], threw = 0, R = rng(2024);
  var levels = [1, 30, 100, 220, 400], stars = [1, 2, 4, 6];
  var reps = FAST ? 1 : 3;
  var queue = [];
  for (var rep = 0; rep < reps; rep++) {
    var sh = pickN(all, all.length, R);
    while (sh.length) queue.push(sh.splice(0, 10));
  }
  queue.forEach(function (ids, qi) {
    while (ids.length < 10) ids.push(all[Math.floor(R() * all.length)]);
    var lv = levels[qi % levels.length], st = stars[(qi >> 1) % stars.length], sk = 1 + Math.floor(R() * 10);
    var A = ids.slice(0, 5).map(function (id) { used[id] = 1; return entry(id, lv, Math.max(st, starFor(lv)), sk); });
    var Bt = ids.slice(5).map(function (id) { used[id] = 1; return entry(id, lv, Math.max(st, starFor(lv)), sk); });
    if (qi % 7 === 3) { Bt[0].boss = true; Bt[0].hpMult = 2.5; }
    try {
      var rec = B.simulate(A, Bt, { seed: qi * 31 + 7 });
      fuzzStats.battles++; fuzzStats.rounds += rec.rounds; fuzzStats.roundsList.push(rec.rounds);
      if (rec.timeout) fuzzStats.timeouts++;
      errs = errs.concat(checkRecord(rec, 'fuzz#' + qi, fuzzStats));
    } catch (e) { threw++; errs.push('fuzz#' + qi + ' threw: ' + e.stack); }
  });
  // uneven sizes & extreme level gaps
  for (var i = 0; i < (FAST ? 20 : 60); i++) {
    var na = 1 + Math.floor(R() * 5), nb = 1 + Math.floor(R() * 5);
    var la = levels[Math.floor(R() * levels.length)], lb = levels[Math.floor(R() * levels.length)];
    var A2 = pickN(all, na, R).map(function (id) { return entry(id, la); }), B2 = pickN(all, nb, R).map(function (id) { return entry(id, lb); });
    try { errs = errs.concat(checkRecord(B.simulate(A2, B2, { seed: 900 + i }), 'mixed#' + i)); }
    catch (e) { threw++; errs.push('mixed#' + i + ' threw: ' + e.message); }
  }
  eq(threw, 0, 'no exceptions in fuzz');
  ok(errs.length === 0, 'all fuzz records well-formed (' + errs.length + ' problems)' + (errs.length ? ':\n      ' + errs.slice(0, 8).join('\n      ') : ''));
  var missing = all.filter(function (id) { return !used[id]; });
  ok(missing.length === 0, 'every defined character fought (' + all.length + ')' + (missing.length ? ' missing ' + missing.join(',') : ''));
  ok(fuzzStats.ults > 0, 'ult events occur (' + fuzzStats.ults + ' of ' + fuzzStats.acts + ' actions)');
  var avg = fuzzStats.rounds / Math.max(1, fuzzStats.battles);
  ok(avg >= 4 && avg <= 16, 'average rounds sane: ' + avg.toFixed(1));
  ok(fuzzStats.timeouts / Math.max(1, fuzzStats.battles) < 0.05, 'timeouts < 5% (' + fuzzStats.timeouts + '/' + fuzzStats.battles + ')');
})();

/* ------------------------------------------------------------------ 7b. every character at the extremes + perf */
section('every character: finite stats, solo/boss battles, cross-instance determinism, performance');
(function () {
  var all = NG.CHARS.map(function (c) { return c.id; }), badStats = [], errs = [], threw = [], R = rng(31);
  all.forEach(function (id, i) {
    [[1, 1, 1], [100, 2, 3], [221, 4, 6], [400, 6, 10]].forEach(function (p) {
      var s = G.stats(id, entry(id, p[0], p[1], p[2]));
      Object.keys(s).forEach(function (k) { if (!finite(s[k])) badStats.push(id + '@' + p[0] + '.' + k); });
      if (!(s.power > 0 && s.hp > 0 && s.atk > 0 && s.spd > 0)) badStats.push(id + '@' + p[0] + ' non-positive');
    });
    try {
      errs = errs.concat(checkRecord(B.simulate([entry(id, 400, 6, 10)], [entry(id, 400, 6, 10)], { seed: i }), id + ' mirror'));
      var boss = entry(id, 400, 6, 10); boss.boss = true; boss.hpMult = 3; boss.mult = 3;
      var foes = pickN(all, 5, R).map(function (x) { return entry(x, 400, 6, 10); });
      errs = errs.concat(checkRecord(B.simulate(foes, [boss], { seed: i + 1 }), id + ' boss'));
    } catch (e) { threw.push(id + ': ' + e.message); }
  });
  ok(badStats.length === 0, 'every character has finite, positive stats at Lv1★1 … Lv400★6' + (badStats.length ? ': ' + badStats.slice(0, 5).join(', ') : ''));
  ok(threw.length === 0 && errs.length === 0, 'every character fights solo (mirror) and as an elite boss without NaN/Infinity or format errors' +
    (threw.length || errs.length ? ': ' + threw.concat(errs).slice(0, 4).join(' | ') : ''));
  // the same battle in a separately loaded engine instance is byte-identical
  var ids = pickN(all, 10, R), A = ids.slice(0, 5).map(function (x) { return entry(x, 300, 5, 7); }), Bt = ids.slice(5).map(function (x) { return entry(x, 300, 5, 7); });
  var other = makeContext({ quiet: true });
  eq(JSON.stringify(other.NG.battle.simulate(A, Bt, { seed: 77 })), JSON.stringify(B.simulate(A, Bt, { seed: 77 })), 'cross-instance determinism');
  var st0 = G.stages(), same = st0.every(function (s) { return JSON.stringify(G.battleStage(s.id, 11).events) === JSON.stringify(G.battleStage(s.id, 11).events); });
  ok(same, 'battleStage deterministic on all ' + st0.length + ' stages');
  // performance
  var M = FAST ? 200 : 600, teams = [];
  for (var k = 0; k < M; k++) teams.push([pickN(all, 5, R).map(function (x) { return entry(x, 150, 2, 5); }), pickN(all, 5, R).map(function (x) { return entry(x, 150, 2, 5); })]);
  for (var w = 0; w < 30; w++) B.simulate(teams[w][0], teams[w][1], { seed: w });
  var tp = Date.now(), evn = 0;
  teams.forEach(function (tm, j) { evn += B.simulate(tm[0], tm[1], { seed: j }).events.length; });
  var ms = (Date.now() - tp) / M;
  console.log('  info: simulate() 5v5 Lv150 ≈ ' + ms.toFixed(2) + ' ms/battle (' + (evn / M).toFixed(0) + ' events avg, ' + M + ' battles)');
  ok(ms < 25, 'simulate() is fast enough for instant replays (< 25 ms per battle)');
  var tc = Date.now(); G._internal.invalidate(); G.chapters();
  console.log('  info: campaign build ' + (Date.now() - tc) + ' ms (cached afterwards)');
})();

/* ------------------------------------------------------------------ 8. campaign battles with real save flow */
section('campaign smoke: auto team after opening pulls');
(function () {
  G.reset();
  for (var i = 0; i < 10; i++) G.summon(100);
  G.autoTeam();
  ok(G.state.team.length === 5, 'autoTeam picks 5');
  var tp0 = G.teamPower();
  // spend the opening coins evenly
  for (var g = 0; g < 600; g++) {
    var low = G.state.team.map(function (id) { return G.owned(id); }).sort(function (a, b) { return a.lv - b.lv; })[0];
    var id = G.state.team.filter(function (x) { return G.owned(x) === low; })[0];
    if (!G.levelUp(id, 1).ok) break;
  }
  ok(G.teamPower() > tp0 * 3, 'opening coins multiply team power (' + NG.fmt(tp0) + ' → ' + NG.fmt(G.teamPower()) + ')');
  var wins = 0, tried = 0, errs = [];
  for (var k = 0; k < 40; k++) {
    var id2 = G.nextStage(); if (!id2) break;
    var rec = G.battleStage(id2, k);
    errs = errs.concat(checkRecord(rec, id2));
    tried++;
    if (G.finishStage(id2, rec).win) wins++; else break;
  }
  ok(errs.length === 0, 'campaign battle records well-formed' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  ok(wins >= 9, 'fresh 1000-pull team clears at least chapter 1 (' + wins + ' stages)');
  console.log('  info: opening team (power ' + NG.fmt(G.teamPower()) + ') cleared ' + wins + ' stages in a row; next ' + G.nextStage() +
    ' recommends ' + NG.fmt((G.stage(G.nextStage()) || {}).power || 0));
})();

/* ------------------------------------------------------------------ 9. balance report */
section('balance report');
(function () {
  var R = rng(777), N = FAST ? 60 : 200;
  function team(pool, lv) { return pickN(pool, Math.min(5, pool.length), R).map(function (id) { return entry(id, lv); }); }
  function run(pa, pb, lv, n) {
    var w = 0, rounds = 0;
    for (var i = 0; i < n; i++) { var r = B.simulate(team(pa, lv), team(pb, lv), { seed: i * 13 + 1 }); if (r.winner === 'A') w++; rounds += r.rounds; }
    return { w: w / n, r: rounds / n };
  }
  var rs = ['UR', 'SSR', 'SR', 'R'].filter(function (r) { return byRarity[r].length; });
  console.log('  Equal level (Lv100), same-rarity mirror matches — avg rounds:');
  rs.forEach(function (r) { var x = run(byRarity[r], byRarity[r], 100, N); console.log('    ' + (r + ' v ' + r).padEnd(10) + ' A win ' + (x.w * 100).toFixed(0).padStart(3) + '%  rounds ' + x.r.toFixed(1)); });
  console.log('  Equal level (Lv100), cross-rarity — win rate of the higher rarity:');
  for (var i = 0; i < rs.length; i++) for (var j = i + 1; j < rs.length; j++) {
    var x = run(byRarity[rs[i]], byRarity[rs[j]], 100, N);
    console.log('    ' + (rs[i] + ' v ' + rs[j]).padEnd(10) + ' ' + (x.w * 100).toFixed(0).padStart(3) + '%  rounds ' + x.r.toFixed(1));
  }
  var all = NG.CHARS.map(function (c) { return c.id; });
  var mix = run(all, all, 150, N);
  console.log('  Random mixed 5v5 at Lv150: rounds ' + mix.r.toFixed(1) + ', ult share of actions ' + (fuzzStats.ults / fuzzStats.acts * 100).toFixed(1) + '%, crit share ' + (fuzzStats.crit / fuzzStats.dmg * 100).toFixed(1) + '%');
  // power-matched: does "recommended power" mean what it says?
  var strong = byRarity.UR.concat(byRarity.SSR);
  if (strong.length >= 5) {
    var I = G._internal, line = [];
    [1, 3, 5].forEach(function (n) {
      var w = 0, rounds = 0, M = FAST ? 40 : 120;
      for (var k = 0; k < M; k++) {
        var A = pickN(strong, 5, R).map(function (id) { return entry(id, 150); });
        var p = A.reduce(function (a, e) { return a + G.power(e.id, e); }, 0);
        var ids = pickN(all, n, R).map(function (id, q) { return { id: id, boss: n === 1 && q === 0 }; });
        var Bt = I.buildLineup(ids, p, 2.5);
        var r = B.simulate(A, Bt, { seed: 5000 + k });
        if (r.winner === 'A') w++; rounds += r.rounds;
      }
      line.push(n + ' enemies: ' + (w / M * 100).toFixed(0) + '% (' + (rounds / M).toFixed(1) + ' rds)');
    });
    console.log('  Team power = stage recommended power → player win rate: ' + line.join(', '));
  }
  var sorted = fuzzStats.roundsList.slice().sort(function (a, b) { return a - b; });
  console.log('  Fuzz rounds p10/p50/p90: ' + sorted[Math.floor(sorted.length * 0.1)] + '/' + sorted[Math.floor(sorted.length * 0.5)] + '/' + sorted[Math.floor(sorted.length * 0.9)] +
    ', biggest single hit ' + (fuzzStats.maxHit * 100).toFixed(0) + '% of target max HP (level-mismatched fights included)');
})();

/* ------------------------------------------------------------------ 9b. per-stage difficulty at recommended power */
/* Teams look like what players actually field: after the 1000-pull opening the best five are URs (UR+SSR only
 * if the pool has fewer than 5 URs), stars run 0–2 ahead of the level (shards from dupes; ★4 awakens matter a
 * lot), skill levels ≈ 1 + lv/38. The level is the highest whose team power ≤ the stage's recommended power. */
function stageWinRates(g, nb, sims, seedBase) {
  var urs = nb.CHARS.filter(function (c) { return c.rarity === 'UR'; }).map(function (c) { return c.id; });
  var strong = urs.length >= 5 ? urs : nb.CHARS.filter(function (c) { return c.rarity === 'UR' || c.rarity === 'SSR'; }).map(function (c) { return c.id; });
  if (strong.length < 5) return null;
  function sk(lv) { return Math.min(10, 1 + Math.floor(lv / 38)); }
  function mk(ids, lv, dst) { var k = sk(lv); return ids.map(function (id, i) { return { id: id, lv: lv, star: Math.min(6, starFor(lv) + dst[i]), skills: { passive: k, s1: k, s2: k, ult: k, awaken: k } }; }); }
  function pw(t) { return t.reduce(function (a, e) { return a + g.power(e.id, e); }, 0); }
  return g.stages().map(function (st) {
    var R = nb.battle.rng((seedBase || 0) + st.index + 1), w = 0, rounds = 0, over = 0;
    for (var i = 0; i < sims; i++) {
      var ids = pickN(strong, 5, R), lo = 1, hi = 400, dst = [];
      for (var d = 0; d < 5; d++) { var x = R(); dst.push(x < 0.3 ? 0 : x < 0.8 ? 1 : 2); }
      while (lo < hi) { var m = (lo + hi + 1) >> 1; if (pw(mk(ids, m, dst)) <= st.power) lo = m; else hi = m - 1; }
      if (lo === 1 && pw(mk(ids, 1, dst)) > st.power * 1.02) over++;
      var rec = nb.battle.simulate(mk(ids, lo, dst), JSON.parse(JSON.stringify(st.enemies)), { seed: (seedBase || 0) * 1000 + i });
      if (rec.winner === 'A') w++; rounds += rec.rounds;
    }
    return { id: st.id, w: w / sims, r: rounds / sims, over: over / sims };
  });
}
/* --calibrate [iters=6] [--calib-n N=120]: per-stage root finding on ln(STAGE_ADJ) so that a player-like team (above) at
 * exactly the recommended power wins CAL_TARGET of the time. Common random numbers (the same teams & battle seeds
 * every iteration) keep successive measurements comparable; the step is a secant/Newton step on the measured
 * slope (win% falls ~1.5–3.5 points per 1% of enemy strength), falling back to a conservative fixed slope. */
var CAL_TARGET = 0.78;
if (ARGS.indexOf('--calibrate') >= 0) {
  section('calibrating per-stage STAGE_ADJ (target ' + CAL_TARGET * 100 + '% win at recommended power)');
  var I = G._internal, adj = JSON.parse(JSON.stringify(I.getStageAdj())), iters = parseInt(ARGS[ARGS.indexOf('--calibrate') + 1], 10) || 6;
  var calN = ARGS.indexOf('--calib-n') >= 0 ? parseInt(ARGS[ARGS.indexOf('--calib-n') + 1], 10) || 120 : 120;
  var hist = {};
  for (var it = 0; it < iters; it++) {
    I.setStageAdj(adj);
    var rows = stageWinRates(G, NG, calN, 4242);
    rows.forEach(function (x) {
      // recommended power below what a Lv1 opening team already has (early ch1–2): nothing to fit, keep 1
      if (x.over > 0.5) { adj[x.id] = 1; return; }
      var la = Math.log(adj[x.id] || 1), h = hist[x.id], slope = -2.2;
      if (h && Math.abs(la - h.la) > 0.005 && Math.abs(x.w - h.w) > 0.02) slope = Math.max(-6, Math.min(-0.8, (x.w - h.w) / (la - h.la)));
      hist[x.id] = { la: la, w: x.w };
      var step = Math.max(-0.2, Math.min(0.2, (x.w - CAL_TARGET) / -slope));
      if (Math.abs(x.w - CAL_TARGET) < 0.025) step = 0;            // within sampling noise: leave it
      adj[x.id] = Math.round(Math.min(2, Math.max(0.5, Math.exp(la + step))) * 100) / 100;
    });
    var fit = rows.filter(function (x) { return x.over <= 0.5; });
    var ws = fit.map(function (x) { return x.w; }).sort(function (a, b) { return a - b; });
    var mad = fit.reduce(function (a, x) { return a + Math.abs(x.w - CAL_TARGET); }, 0) / fit.length;
    if (!it) console.log('  not fitted (a Lv1 opening team already exceeds the recommended power): ' + rows.filter(function (x) { return x.over > 0.5; }).map(function (x) { return x.id; }).join(' '));
    console.log('  iter ' + (it + 1) + ' (n=' + calN + '): win% min ' + (ws[0] * 100).toFixed(0) + ' p10 ' + (ws[Math.floor(ws.length * 0.1)] * 100).toFixed(0) + ' median ' + (ws[ws.length >> 1] * 100).toFixed(0) +
      ' p90 ' + (ws[Math.floor(ws.length * 0.9)] * 100).toFixed(0) + ', mean |win−target| ' + (mad * 100).toFixed(1));
  }
  var keys = Object.keys(adj).filter(function (k) { return adj[k] !== 1; }).sort(function (a, b) {
    var x = a.split('-').map(Number), y = b.split('-').map(Number); return (x[0] - y[0]) || (x[1] - y[1]);
  });
  console.log('\n  var STAGE_ADJ = {');
  var line = '   ';
  keys.forEach(function (k, i) { var t = " '" + k + "': " + adj[k] + (i < keys.length - 1 ? ',' : ''); if (line.length + t.length > 110) { console.log(line); line = '   '; } line += t; });
  console.log(line + '\n  };');
}

section('per-stage difficulty (player-like UR team at exactly the recommended power)');
(function () {
  var rows = stageWinRates(G, NG, FAST ? 12 : 30, 99);
  if (!rows) { console.log('  skipped (fewer than 5 UR/SSR characters)'); return; }
  var ws = rows.map(function (x) { return x.w; }).sort(function (a, b) { return a - b; });
  var rr = rows.reduce(function (a, x) { return a + x.r; }, 0) / rows.length;
  console.log('  win% min ' + (ws[0] * 100).toFixed(0) + ' / p10 ' + (ws[Math.floor(ws.length * 0.1)] * 100).toFixed(0) + ' / median ' + (ws[ws.length >> 1] * 100).toFixed(0) +
    ' / p90 ' + (ws[Math.floor(ws.length * 0.9)] * 100).toFixed(0) + ' / max ' + (ws[ws.length - 1] * 100).toFixed(0) + ', avg rounds ' + rr.toFixed(1));
  var hard = rows.filter(function (x) { return x.w < 0.4; }).map(function (x) { return x.id + ' ' + (x.w * 100).toFixed(0) + '%'; });
  if (hard.length) console.log('  hardest at recommended power: ' + hard.join(', '));
  ok(ws[ws.length >> 1] >= 0.5, 'median stage is winnable at recommended power');
})();

/* ------------------------------------------------------------------ 10. optional progression sim */
/* A "realistic" player: fresh save → 10 × 100-pull → autoTeam → spend everything on the best five (star-ups,
 * cheap skill levels, then levels evenly) → play the campaign in order. Time model (active play): a first
 * attempt is watched at ×2 (10 s intro/result + 0.55 s per action + 1 s per ult cut-in), retries are skipped
 * (12 s), each spending session costs a few seconds of taps. After 3 losses in a row the player goes away for
 * --afk hours (default 2, offline: AFK income keeps accruing, it is not active time), claims the chest,
 * spends and tries again; after the 2nd break on the same stage they also try other line-ups (5 of their best 8,
 * levelled with the surplus coins). Reports active/wall-clock time per chapter. */
function progressionSim(n) {
  var afkH = ARGS.indexOf('--afk') >= 0 ? parseFloat(ARGS[ARGS.indexOf('--afk') + 1]) || 2 : 2;
  var econ = ARGS.indexOf('--econ') >= 0 ? JSON.parse(ARGS[ARGS.indexOf('--econ') + 1]) : null;
  var verbose = ARGS.indexOf('--sim-verbose') >= 0;
  var chp = ARGS.indexOf('--chp') >= 0 ? JSON.parse(ARGS[ARGS.indexOf('--chp') + 1]) : null;   // CH_END_POWER override (experiments)
  console.log('\n== progression simulation (' + n + ' players, AFK break ' + afkH + 'h when stuck' + (econ ? ', econ ' + JSON.stringify(econ) : '') + ')');
  var agg = {}, totals = [], stageLoss = {};
  function med(a) { var s = a.slice().sort(function (x, y) { return x - y; }); return s.length ? s[s.length >> 1] : 0; }
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }
  for (var sd = 1; sd <= n; sd++) {
    var c = makeContext({ quiet: true }), g = c.NG.game, NGc = c.NG, T0 = 1.8e12, T = T0;
    if (econ) Object.keys(econ).forEach(function (k) { g.econ[k] = econ[k]; });
    if (chp) chp.forEach(function (v, i) { if (v) g._internal.CH_END_POWER[i] = v; });
    g._setClock(function () { return T; });
    g.reset(); g.state.rng = sd * 7919;
    var R = NGc.battle.rng(sd), active = 0, afk = 0, fights = 0, losses = 0, attempts = 0, stuck = 0, seen = {};
    var play = function (sec) { active += sec; T += sec * 1000; };
    var battleSecs = function (rec, watched) {
      if (!watched) return 12;
      var acts = 0, ults = 0;
      rec.events.forEach(function (e) { if (e.t === 'act') { acts++; if (e.skill === 'ult') ults++; } });
      return 10 + acts * 0.55 + ults;
    };
    var rankIds = function (k) {        // best k by power once levelled to the current team's top level
      var s = g.state, top = Math.max.apply(null, s.team.map(function (id) { return g.owned(id) ? g.owned(id).lv : 1; }).concat([1]));
      return g.ownedList().map(function (x) { var lv = Math.min(g.maxLevel(x.id), Math.max(x.e.lv, top)); return { id: x.id, p: g.power(x.id, { lv: lv, star: x.e.star, skills: x.e.skills }) }; })
        .sort(function (a, b) { return b.p - a.p; }).slice(0, k).map(function (x) { return x.id; });
    };
    var otherTeam = function () {       // stuck for a while: try another five out of the best eight, level them up
      var pool = rankIds(8), pick = [];
      while (pick.length < 5 && pool.length) pick.push(pool.splice(Math.floor(R() * pool.length), 1)[0]);
      g.setTeam(pick);
      pick.forEach(function (id) { g.levelUp(id, 'max'); });
      return 20;
    };
    var spend = function () {
      var s = g.state, t = 0, q;
      while (s.tickets >= 100) { g.summon(100); t += 15; }
      while (s.tickets >= 10) { g.summon(10); t += 6; }
      while (s.gems >= 1500) { g.summon(10); t += 6; }
      Object.keys(s.roster).forEach(function (id) { while (g.starUp(id).ok) t += 2; });
      var ranked = rankIds(5);
      if (ranked.join() !== s.team.join()) { g.setTeam(ranked); t += 10; }
      for (q = 0; q < 300; q++) {
        var best = null;
        s.team.forEach(function (id) { ['ult', 's2', 's1', 'passive', 'awaken'].forEach(function (k) { if (!g.skillUnlocked(id, k)) return; var cc = g.skillCost(id, k); if (cc && cc.scrolls <= s.scrolls && cc.coins <= s.coins * 0.1 && (!best || cc.scrolls < best.c.scrolls)) best = { id: id, k: k, c: cc }; }); });
        if (!best) break; g.skillUp(best.id, best.k); t += 1;
      }
      var lv0 = s.team.reduce(function (a, id) { return a + g.owned(id).lv; }, 0);
      for (q = 0; q < 3000; q++) {
        var cand = s.team.map(function (id) { return { id: id, e: g.owned(id) }; }).filter(function (x) { return x.e.lv < g.maxLevel(x.id); }).sort(function (a, b) { return a.e.lv - b.e.lv; })[0];
        if (!cand || !g.levelUp(cand.id, 1).ok) break;
      }
      if (s.team.reduce(function (a, id) { return a + g.owned(id).lv; }, 0) > lv0) t += 8;
      return t;
    };
    for (var i = 0; i < 10; i++) g.summon(100);
    g.autoTeam(); spend();
    var openPower = g.teamPower(), ch = {}, cur = 0, chStart = 0, chAfk = 0, chLoss = 0, chFirst = 0, chWin1 = 0, chRatio = 0;
    var close = function () { if (cur) ch[cur] = { act: active - chStart, cum: active, wall: (T - T0) / 1000, afk: chAfk, loss: chLoss, win1: chFirst ? chWin1 / chFirst : 1, ratio: chRatio }; };
    for (var step = 0; step < 5000; step++) {
      var sid = g.nextStage(); if (!sid) break;
      var stg = g.stage(sid);
      if (stg.ch !== cur && verbose) console.log('    ' + sid + ' reco ' + NGc.fmt(stg.power) + ' team ' + NGc.fmt(g.teamPower()) + ' coins ' + NGc.fmt(g.state.coins) + ' [' +
        g.state.team.map(function (id) { var e = g.owned(id); return 'Lv' + e.lv + '/' + g.maxLevel(id) + '★' + e.star + ' ' + e.shards + '/' + (g.starCost(id) || '-'); }).join(', ') + '] ' + (active / 3600).toFixed(2) + 'h, AFK so far ' + afk);
      if (stg.ch !== cur) { close(); cur = stg.ch; chStart = active; chAfk = 0; chLoss = 0; chFirst = 0; chWin1 = 0; chRatio = g.teamPower() / stg.power; }
      var watched = !seen[sid]; seen[sid] = 1;
      var rec = g.battleStage(sid, Math.floor(R() * 1e9)); fights++;
      play(battleSecs(rec, watched));
      var fin = g.finishStage(sid, rec);
      if (watched) { chFirst++; if (fin.win) chWin1++; }
      if (fin.win) { attempts = 0; stuck = 0; }
      else {
        losses++; chLoss++; stageLoss[sid] = (stageLoss[sid] || 0) + 1;
        if (++attempts >= 3) { afk++; chAfk++; stuck++; T += afkH * 3600e3; attempts = 0; }
      }
      if ((g.idle().seconds >= 600 || !fin.win) && g.claimIdle().ok) play(3);
      play(spend());
      if (stuck >= 2) play(otherTeam());
    }
    close();
    var done = !g.nextStage();
    totals.push({ act: active, wall: (T - T0) / 1000, done: done });
    console.log('  player ' + sd + ': opening power ' + NGc.fmt(openPower) + ' → ' + (done ? 'cleared everything' : 'stuck at ' + g.nextStage()) + ' after ' + (active / 3600).toFixed(2) + 'h active / ' +
      ((T - T0) / 3600e3).toFixed(1) + 'h wall-clock; ' + fights + ' fights, ' + losses + ' losses, ' + afk + ' AFK breaks, ' + g.state.totalPulls + ' pulls; team [' +
      g.state.team.map(function (id) { var e = g.owned(id); return NGc.CHAR_MAP[id].rarity + ' Lv' + e.lv + '★' + e.star; }).join(', ') + '] ' + NGc.fmt(g.teamPower()));
    Object.keys(ch).forEach(function (k) {
      var x = ch[k], a = agg[k] = agg[k] || { act: [], cum: [], wall: [], afk: [], loss: [], win1: [], ratio: [] };
      Object.keys(a).forEach(function (q) { a[q].push(x[q]); });
    });
  }
  console.log('  chapter          active min  cum active h  cum wall h  1st-try win  AFK breaks  losses  power/reco at start   (medians; breaks & losses are means)');
  Object.keys(agg).sort(function (a, b) { return a - b; }).forEach(function (k) {
    var a = agg[k];
    console.log('  ' + ('ch' + k).padEnd(15) + (med(a.act) / 60).toFixed(1).padStart(10) + (med(a.cum) / 3600).toFixed(2).padStart(14) + (med(a.wall) / 3600).toFixed(1).padStart(12) +
      ((med(a.win1) * 100).toFixed(0) + '%').padStart(13) + mean(a.afk).toFixed(1).padStart(12) + mean(a.loss).toFixed(1).padStart(8) + med(a.ratio).toFixed(2).padStart(12));
  });
  var worst = Object.keys(stageLoss).sort(function (a, b) { return stageLoss[b] - stageLoss[a]; }).slice(0, 10);
  console.log('  most losses: ' + worst.map(function (k) { return k + ' ×' + stageLoss[k]; }).join(', '));
  var cleared = totals.filter(function (x) { return x.done; });
  console.log('  → ' + cleared.length + '/' + totals.length + ' players cleared the campaign; median ' + (med(cleared.map(function (x) { return x.act; })) / 3600).toFixed(2) + 'h active, ' +
    (med(cleared.map(function (x) { return x.wall; })) / 3600).toFixed(1) + 'h wall-clock');
}
if (SIM_N) progressionSim(SIM_N);

/* ------------------------------------------------------------------ summary */
console.log('\n' + (failed ? 'FAILED' : 'OK') + ': ' + passed + ' passed, ' + failed + ' failed (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
var DELIBERATE = /"(nobody|ghost|charisma|teleport|moon|luck|confuse|sideways|on_sneeze)"/;
var engineWarns = ctx._warns.filter(function (w) { return /NG\.engine/.test(w) && !DELIBERATE.test(w); });
console.log('engine warnings from real data: ' + (engineWarns.length ? engineWarns.length + ' — ' + engineWarns.slice(0, 12).join(' | ') : 'none') +
  ' (' + ctx._warns.filter(function (w) { return DELIBERATE.test(w); }).length + ' more were provoked on purpose by the unknown-vocabulary test)');
process.exit(failed ? 1 : 0);
