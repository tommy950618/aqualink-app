// Unit checks for src/lineup.js and src/legends.js (spec §2, §5.12): legends data integrity, names / numbers / stats
// against the baked header meta (assets/legends/legends.json; the bake config's meta while the v2 assets are not
// baked yet), composites (§2.4), card chips, swap / handler / shuffle / reset, kit modes and team names (§5.12.3),
// persistence with a throwing or missing localStorage, URL parsing, CPU check-ball receiver weights (§5.12.4).
// Run: node test/unit-lineup.mjs
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  LEGEND_IDS, LEGENDS, TEAMS_V2, DEFAULT_LINEUP, TEAM_UI, ALLSTAR_KITS, RATING_KEYS, legend, isLegendId, composites,
  topStats, backName,
} from '../src/legends.js';
import {
  copyLineup, resetLineup, validateLineup, normalizeLineup, isDefaultLineup, swap, setHandler, setUser, setKits, shuffle,
  resolveKitModes, teamNames, kitClash, entersAllStar, kitModeById, loadLineup, saveLineup, clearLineupMemory,
  parseLineupParam, formatLineupParam, lineupFromQuery, checkWeights, pickCheckReceiver, makeCheckState, slotId, slotOf,
  coversAllLegends, LINEUP_STORAGE_KEY, SHUFFLE_SEED_XOR, KIT_OPTIONS,
} from '../src/lineup.js';
import { SLOTS_V2 } from '../src/constants.js';
import { Rng } from '../src/math.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (±${tol})`);

// ------------------------------------------------------------------------------------------------ legends.js data

check('six legends in header order, complete schema, deeply frozen', () => {
  assert.deepEqual([...LEGEND_IDS], ['kobe', 'jordan', 'lebron', 'giannis', 'yao', 'kyrie']);
  for (const id of LEGEND_IDS) {
    const L = LEGENDS[id];
    assert.equal(L.id, id);
    for (const k of ['name', 'short', 'number', 'era', 'hand', 'stats', 'shoulderJoints', 'ratings', 'release', 'abilities',
      'traits', 'tend', 'spots', 'look', 'kit']) assert.ok(L[k] !== undefined, id + '.' + k);
    assert.ok(Object.isFrozen(L) && Object.isFrozen(L.ratings) && Object.isFrozen(L.kit.shoes) && Object.isFrozen(L.tend.contestJump));
    assert.equal(typeof L.number, 'string');
    assert.equal(L.hand, 'R');
    for (const k of RATING_KEYS) assert.ok(Number.isInteger(L.ratings[k]) && L.ratings[k] >= 25 && L.ratings[k] <= 99, id + ' ' + k);
    assert.equal(Object.keys(L.ratings).length, 16);
    assert.ok(L.release.jumper > 2.5 && L.release.fade > 2.5);
    for (const k of ['chaseBlock', 'canDunkTraffic', 'noDribbleMoves', 'threeGate', 'maxDribbles']) assert.ok(k in L.traits);
    // spots: weights sum to 1 over valid SLOTS_V2 ids
    let s = 0;
    for (const sid of Object.keys(L.spots)) { assert.ok(SLOTS_V2[sid], id + ' spot ' + sid); s += L.spots[sid]; }
    near(s, 1, 1e-9, id + ' spots');
    // shot-mix multipliers m = 0.6 + 1.6·share (§2.5)
    near(L.tend.shotRim, 0.6 + 1.6 * L.tend.mix.rim, 0.011, id + ' shotRim');
    near(L.tend.shotMid, 0.6 + 1.6 * L.tend.mix.mid, 0.011, id + ' shotMid');
    if (id !== 'yao') near(L.tend.shotThree, 0.6 + 1.6 * L.tend.mix.three, 0.011, id + ' shotThree');
    assert.ok(L.kit.classic === 'home' || L.kit.classic === 'away');
    assert.ok(L.kit[L.kit.classic] && L.kit[L.kit.classic].base.startsWith('#'));
    assert.equal(L.kit[L.kit.classic === 'home' ? 'away' : 'home'], null);
  }
  assert.throws(() => { LEGENDS.kobe.ratings.three = 99; });
});

check('identity, stats and ratings tables (§2.2, §2.3)', () => {
  const row = (k) => LEGEND_IDS.map((id) => k(LEGENDS[id]));
  assert.deepEqual(row((L) => L.number), ['24', '23', '23', '34', '11', '2']);
  assert.deepEqual(row((L) => L.name.en), ['Kobe Bryant', 'Michael Jordan', 'LeBron James', 'Giannis Antetokounmpo', 'Yao Ming', 'Kyrie Irving']);
  assert.deepEqual(row((L) => L.short.en), ['Kobe', 'Jordan', 'LeBron', 'Giannis', 'Yao', 'Kyrie']);
  assert.deepEqual(row((L) => L.era), ['2008-10', '1991-98', '2016-18', '2019-21', '2004-09', '2014-17']);
  assert.deepEqual(row((L) => L.stats.heightM), [1.98, 1.98, 2.06, 2.11, 2.29, 1.88]);
  assert.deepEqual(row((L) => L.stats.barefootM), [1.96, 1.96, 2.03, 2.09, 2.27, 1.87]);
  assert.deepEqual(row((L) => L.stats.weightKg), [96, 98, 113.4, 110, 141, 88]);
  assert.deepEqual(row((L) => L.stats.wingspanM), [2.11, 2.11, 2.14, 2.21, 2.26, 1.93]);
  assert.deepEqual(row((L) => L.stats.reachM), [2.64, 2.65, 2.69, 2.81, 2.95, 2.515]);
  assert.deepEqual(row((L) => L.shoulderJoints), [0.455, 0.460, 0.505, 0.485, 0.490, 0.425]);
  assert.deepEqual(row((L) => L.ratings.overall), [97, 98, 98, 96, 89, 93]);
  assert.deepEqual(row((L) => [L.ratings.speed, L.ratings.strength, L.ratings.vertical]),
    [[85, 72, 88], [91, 72, 94], [87, 98, 88], [88, 92, 95], [38, 86, 42], [91, 55, 80]]);
  assert.deepEqual(row((L) => L.ratings.ballHandle), [91, 88, 88, 76, 42, 99]);
  assert.deepEqual(row((L) => [L.ratings.closeShot, L.ratings.midRange, L.ratings.three]),
    [[92, 98, 84], [95, 99, 76], [93, 82, 77], [93, 66, 58], [95, 80, 30], [90, 93, 90]]);
  assert.deepEqual(row((L) => [L.ratings.dunk, L.ratings.layup]), [[88, 95], [96, 98], [96, 96], [99, 95], [72, 74], [55, 99]]);
  assert.deepEqual(row((L) => L.ratings.passing), [82, 82, 97, 79, 66, 84]);
  assert.deepEqual(row((L) => [L.ratings.perimeterD, L.ratings.interiorD]), [[93, 55], [97, 58], [88, 82], [87, 91], [50, 97], [70, 36]]);
  assert.deepEqual(row((L) => [L.ratings.block, L.ratings.steal, L.ratings.rebound]),
    [[50, 86, 60], [63, 96, 66], [74, 78, 87], [88, 74, 94], [96, 42, 90], [35, 72, 45]]);
  assert.deepEqual(row((L) => [L.release.jumper, L.release.fade, L.release.hook]),
    [[3.00, 2.95, null], [3.00, 3.00, null], [2.85, 2.85, null], [2.90, 2.90, 3.05], [3.45, 3.40, 3.55], [2.80, 2.80, null]]);
  assert.deepEqual(row((L) => L.traits.chaseBlock), [1, 1, 2, 1, 0, 0]);
  assert.deepEqual(row((L) => L.traits.canDunkTraffic), [true, true, true, true, false, false]);
  assert.deepEqual(row((L) => L.traits.maxDribbles), [null, null, null, null, 2, null]);
  assert.deepEqual(row((L) => L.traits.threeGate), [null, null, null, 2.5, Infinity, null]);
  assert.deepEqual([...LEGENDS.jordan.abilities], ['jordan.fade', 'jordan.air', 'jordan.ftDunk', 'jordan.hawk', 'clutch']);
  assert.equal(LEGENDS.giannis.short.en, 'Giannis');
});

check('tendencies table (§2.5) spot checks and contest-jump pairs', () => {
  const T = (k) => LEGEND_IDS.map((id) => LEGENDS[id].tend[k]);
  assert.deepEqual(T('shotRim'), [1.00, 1.21, 1.32, 1.56, 0.68, 1.24]);
  assert.deepEqual(T('shotClose'), [0.80, 0.80, 0.80, 0.84, 1.08, 0.76]);
  assert.deepEqual(T('shotMid'), [1.32, 1.32, 0.84, 0.76, 1.16, 1.00]);
  assert.deepEqual(T('shotThree'), [0.84, 0.76, 0.92, 0.84, 0, 1.00]);
  assert.deepEqual(T('post'), [0.84, 0.72, 0.76, 0.60, 1.56, 0]);
  assert.deepEqual(T('iso'), [1.10, 1.00, 0.80, 0.60, 0, 1.40]);
  assert.deepEqual(T('isoMoves').map((x) => [...x]), [[1, 2], [1, 2], [0, 1], [0, 1], [0, 0], [2, 4]]);
  assert.deepEqual(T('patience'), [2.5, 2.5, 3.0, 1.5, 2.0, 3.5]);
  assert.deepEqual(T('pass'), [0.80, 0.90, 1.35, 1.00, 1.00, 0.85]);
  assert.deepEqual(T('kickWhenDoubled'), [0.60, 0.70, 0.90, 0.75, 0.95, 0.70]);
  assert.deepEqual(T('driveRight'), [0.60, 0.60, 0.50, 0.65, 0.50, 0.60]);
  assert.deepEqual(T('jab'), [0.70, 0.40, 0.15, 0.10, 0.00, 0.10]);
  assert.deepEqual(T('pumpFake'), [0.25, 0.25, 0.10, 0.05, 0.30, 0.10]);
  assert.deepEqual(T('fade'), [0.55, 0.60, 0.25, 0.05, 0.15, 0.20]);
  assert.deepEqual(T('stepback'), [0.25, 0.10, 0.30, 0.00, 0.00, 0.55]);
  assert.deepEqual(T('checkShare'), [0.40, 0.55, 0.50, 0.10, 0.05, 0.40]);
  assert.deepEqual(T('crash'), [0.20, 0.30, 0.35, 0.55, 0.60, 0.05]);
  assert.deepEqual(T('boxOut'), [0.40, 0.50, 0.70, 0.60, 1.00, 0.30]);
  assert.deepEqual(T('stealGamble'), [1.20, 1.30, 1.00, 0.80, 0.20, 1.20]);
  assert.deepEqual(T('help'), [0.60, 0.90, 1.00, 1.50, 1.20, 0.50]);
  assert.deepEqual(T('contestJump').map((x) => [...x]), [[0.70, 0.70], [0.80, 0.80], [0.80, 0.90], [0.80, 0.95], [0.40, 1.00], [0.50, 0.30]]);
  assert.deepEqual(T('closeout'), [1.0, 1.0, 1.0, 1.0, 0.85, 1.0]);
  assert.deepEqual(T('guardBest'), [1, 1, 0, 0, 0, 0]);
  assert.deepEqual(T('riskTol'), [0.15, 0.12, 0.10, 0.18, 0.15, 0.15]);
  assert.deepEqual({ ...LEGENDS.yao.tend.mix }, { rim: 0.05, close: 0.30, mid: 0.35, three: 0.00, post: 0.60 });
});

check('look (§2.6) and kits (§2.7) spot checks', () => {
  assert.equal(LEGENDS.kobe.look.skin, '#8B5A3C');
  assert.equal(LEGENDS.jordan.look.glossBase, 0.55);
  assert.equal(LEGENDS.jordan.look.clearcoatRoughness, 0.22);
  assert.equal(LEGENDS.yao.look.sheenColor, '#8090a0');
  assert.equal(LEGENDS.yao.look.beardSkinMaskK, 0.07);
  assert.equal(LEGENDS.kobe.look.idleFace.channel, 'scowl');
  assert.equal(LEGENDS.jordan.look.idleFace.chewHz, 1.5);
  for (const id of LEGEND_IDS) assert.equal(LEGENDS[id].look.iris, '#2A1A12');
  const classic = (id) => LEGENDS[id].kit[LEGENDS[id].kit.classic];
  assert.deepEqual(LEGEND_IDS.map((id) => LEGENDS[id].kit.classic), ['home', 'away', 'away', 'away', 'away', 'away']);
  assert.deepEqual(LEGEND_IDS.map((id) => classic(id).base), ['#FDB927', '#CE1141', '#6F263D', '#00471B', '#CE1141', '#6F263D']);
  assert.equal(classic('kobe').glyph, 'rounded');
  assert.equal(classic('yao').serifOne, true);
  assert.equal(classic('yao').keyline, '#000000');
  assert.deepEqual(classic('jordan').bands.map((b) => [b.color, b.mm]), [['#000000', 5], ['#FFFFFF', 3], ['#000000', 5]]);
  assert.deepEqual(classic('giannis').shortsStripe.map((b) => b.mm), [2, 40, 2]);
  assert.deepEqual(LEGEND_IDS.map((id) => LEGENDS[id].kit.socks.shell), ['high', 'low', 'crew', 'mid', 'crew', 'crew']);
  assert.deepEqual(LEGEND_IDS.map((id) => LEGENDS[id].kit.backName), ['BRYANT', 'JORDAN', 'JAMES', 'ANTETOKOUNMPO', 'YAO', 'IRVING']);
  assert.equal(backName('yao'), 'YAO');
  assert.deepEqual(LEGEND_IDS.map((id) => LEGENDS[id].kit.shoes.cut), ['low', 'mid-high', 'high', 'low-mid', 'high', 'low']);
  assert.equal(LEGENDS.jordan.kit.shoes.home.id, 'jordanHome');
  assert.equal(LEGENDS.jordan.kit.shoes.away.id, 'jordanAway');
  assert.equal(LEGENDS.jordan.kit.shoes.home.mudguard.roughness, 0.10);
  assert.deepEqual([...LEGENDS.kyrie.kit.shoes.away], ['#111111', '#FFB81C', '#111111']);
  assert.equal(LEGENDS.jordan.kit.extras.undershort.color, '#9bc4e2');
  const worn = (id) => LEGENDS[id].kit.accessories.filter((a) => a.worn).map((a) => a.id);
  assert.deepEqual(worn('kobe'), ['sleeve', 'fingerTape']);
  assert.deepEqual(worn('jordan'), ['wristband']);
  assert.deepEqual(worn('lebron'), ['headbandHigh', 'tattoos']);
  assert.deepEqual(worn('giannis'), []);
  assert.deepEqual(worn('yao'), []);
  assert.deepEqual(worn('kyrie'), ['tattoos', 'mouthguard']);
  assert.equal(LEGENDS.kyrie.kit.accessories.find((a) => a.id === 'headbandLow').worn, false);
  assert.deepEqual({ ...LEGENDS.lebron.kit.accessories[0].colors }, { classic: '#111111', allstarA: '#FFFFFF', allstarB: '#111111' });
  assert.equal(ALLSTAR_KITS.allstarA.base, '#F4F4F1'); assert.equal(ALLSTAR_KITS.allstarA.number, '#C9A227');
  assert.equal(ALLSTAR_KITS.allstarB.base, '#121212'); assert.equal(ALLSTAR_KITS.allstarB.number, '#D22630');
  assert.equal(ALLSTAR_KITS.allstarA.shoes, 'home'); assert.equal(ALLSTAR_KITS.allstarB.shoes, 'away');
});

check('names, numbers and stats equal the baked header meta (or the bake config meta before the v2 bake)', () => {
  const header = path.join(HERE, '../assets/legends/legends.json');
  const config = path.join(HERE, '../tools/legends/legends.config.json');
  const src = existsSync(header) ? header : config;
  const json = JSON.parse(readFileSync(src, 'utf8'));
  const players = json.players;
  assert.equal(players.length, 6);
  const pick = (o, ...keys) => { for (const k of keys) if (o[k] !== undefined) return o[k]; return undefined; };
  players.forEach((p, i) => {
    const id = p.id;
    assert.equal(id, LEGEND_IDS[i], 'header order');
    const meta = p.meta, L = LEGENDS[id];
    assert.equal(meta.nameZh, L.name.zh, id + ' nameZh');
    assert.equal(meta.nameEn, L.name.en, id + ' nameEn');
    assert.equal(String(meta.number), L.number, id + ' number');
    const s = meta.stats;
    assert.equal(pick(s, 'heightM', 'listedHeightM'), L.stats.heightM, id + ' height');
    assert.equal(pick(s, 'barefootM', 'barefootHeightM'), L.stats.barefootM, id + ' barefoot');
    assert.equal(s.weightKg, L.stats.weightKg, id + ' weight');
    assert.equal(s.wingspanM, L.stats.wingspanM, id + ' wingspan');
    assert.equal(pick(s, 'reachM', 'standingReachM'), L.stats.reachM, id + ' reach');
  });
  console.log('   (meta source: ' + path.relative(path.join(HERE, '..'), src) + ')');
});

check('display composites (§2.4) and card stat chips', () => {
  const want = {
    kobe: [92, 90, 76, 72], jordan: [90, 94, 79, 78], lebron: [83, 92, 93, 81],
    giannis: [70, 90, 93, 86], yao: [66, 58, 91, 72], kyrie: [91, 86, 66, 53],
  };
  for (const id of LEGEND_IDS) {
    const c = composites(id);
    assert.deepEqual([c.sht, c.drv, c.ins, c.def], want[id], id);
    assert.ok(Math.max(c.sht, c.drv, c.ins, c.def) >= 90, id + ' has a ≥ 90 composite');
  }
  const out = {};
  assert.equal(composites('yao', out), out);
  assert.equal(composites('nobody'), null);
  assert.deepEqual(topStats('kobe'), [{ key: 'midRange', value: 98 }, { key: 'layup', value: 95 }, { key: 'perimeterD', value: 93 }]);
  // ties → table order: Kyrie ballHandle 99 before layup 99; Giannis vertical 95 before layup 95
  assert.deepEqual(topStats('kyrie').map((x) => x.key), ['ballHandle', 'layup', 'midRange']);
  assert.deepEqual(topStats('giannis').map((x) => x.key), ['dunk', 'vertical', 'layup']);
  for (const id of LEGEND_IDS) assert.ok(!topStats(id).some((x) => x.key === 'overall'));
});

check('teams, default lineup and team UI colours (§2.9, C16)', () => {
  assert.deepEqual({ ...TEAMS_V2.dark.abbr }, { zh: '暗夜', en: 'DRK' });
  assert.deepEqual({ ...TEAMS_V2.bright.abbr }, { zh: '烈阳', en: 'BRT' });
  assert.deepEqual({ ...TEAMS_V2.allstarA.abbr }, { zh: '白队', en: 'WHT' });
  assert.deepEqual({ ...TEAMS_V2.allstarB.abbr }, { zh: '黑队', en: 'BLK' });
  assert.equal(TEAMS_V2.dark.name.zh, '暗夜队'); assert.equal(TEAMS_V2.bright.name.en, 'Team Bright');
  assert.deepEqual([...TEAMS_V2.dark.roster], ['lebron', 'kyrie', 'giannis']);
  assert.deepEqual([...TEAMS_V2.bright.roster], ['jordan', 'kobe', 'yao']);
  assert.deepEqual(JSON.parse(JSON.stringify(DEFAULT_LINEUP)), { a: ['lebron', 'kyrie', 'giannis'], b: ['jordan', 'kobe', 'yao'], user: 'a', kits: 'auto' });
  assert.deepEqual({ ...TEAM_UI.dark }, { bg: '#6F263D', text: '#FFB81C', accent: '#FFB81C' });
  assert.deepEqual({ ...TEAM_UI.bright }, { bg: '#CE1141', text: '#FFFFFF', accent: '#000000' });
  assert.deepEqual({ ...TEAM_UI.allstarA }, { bg: '#F4F4F1', text: '#1A1A1A', accent: '#D9A520' });
  assert.deepEqual({ ...TEAM_UI.allstarB }, { bg: '#121212', text: '#FFFFFF', accent: '#CE1141' });
  assert.equal(legend('yao'), LEGENDS.yao); assert.equal(legend('toString'), null);
  assert.equal(isLegendId('kobe'), true); assert.equal(isLegendId('constructor'), false);
});

// ------------------------------------------------------------------------------------------------ lineup.js

check('validation, normalisation, default detection (as sets, either side)', () => {
  const d = resetLineup();
  assert.ok(validateLineup(d));
  assert.notEqual(d.a, DEFAULT_LINEUP.a);                  // a fresh copy
  d.a[0] = 'kobe';
  assert.equal(DEFAULT_LINEUP.a[0], 'lebron');
  assert.equal(validateLineup({ a: ['kobe', 'kobe', 'yao'], b: ['jordan', 'lebron', 'kyrie'], user: 'a', kits: 'auto' }), false);
  assert.equal(validateLineup({ a: ['kobe', 'giannis'], b: ['jordan', 'lebron', 'kyrie'], user: 'a', kits: 'auto' }), false);
  assert.equal(validateLineup({ a: ['kobe', 'giannis', 'shaq'], b: ['jordan', 'lebron', 'kyrie'], user: 'a', kits: 'auto' }), false);
  assert.equal(validateLineup({ ...resetLineup(), user: 'c' }), false);
  assert.equal(validateLineup({ ...resetLineup(), kits: 'retro' }), false);
  assert.equal(validateLineup(null), false);
  assert.deepEqual(normalizeLineup({ a: ['yao', 'kobe', 'jordan'], b: ['kyrie', 'giannis', 'lebron'] }),
    { a: ['yao', 'kobe', 'jordan'], b: ['kyrie', 'giannis', 'lebron'], user: 'a', kits: 'auto' });
  assert.equal(normalizeLineup({ a: ['yao'], b: [] }), null);
  assert.ok(isDefaultLineup(resetLineup()));
  assert.ok(isDefaultLineup({ a: ['yao', 'kobe', 'jordan'], b: ['kyrie', 'giannis', 'lebron'], user: 'b', kits: 'classic' }));
  assert.ok(!isDefaultLineup({ a: ['kobe', 'kyrie', 'giannis'], b: ['jordan', 'lebron', 'yao'], user: 'a', kits: 'auto' }));
  assert.deepEqual([...KIT_OPTIONS], ['auto', 'classic', 'allstar']);
});

check('swap across teams, swap order inside a team (★ changes), setHandler, setUser / setKits; inputs untouched', () => {
  const l = resetLineup();
  const frozen = JSON.stringify(l);
  // Kobe (B slot 4) ↔ Kyrie (A slot 1): they change teams
  const s = swap(l, 4, 1);
  assert.deepEqual(s.a, ['lebron', 'kobe', 'giannis']);
  assert.deepEqual(s.b, ['jordan', 'kyrie', 'yao']);
  assert.equal(JSON.stringify(l), frozen);
  // same team: order swap; slot 0 involved → new ★ handler
  const o = swap(l, 0, 2);
  assert.deepEqual(o.a, ['giannis', 'kyrie', 'lebron']);
  assert.ok(isDefaultLineup(o));
  assert.deepEqual(setHandler(l, 5).b, ['yao', 'kobe', 'jordan']);
  assert.deepEqual(setHandler(l, 0), l);
  assert.deepEqual(swap(l, 2, 2), l);
  assert.deepEqual(swap(l, -1, 2), l);
  assert.equal(setUser(l, 'b').user, 'b'); assert.equal(setUser(l, 'x').user, 'a');
  assert.equal(setKits(l, 'allstar').kits, 'allstar'); assert.equal(setKits(l, 'bogus').kits, 'auto');
  assert.equal(slotId(l, 3), 'jordan'); assert.equal(slotOf(l, 'yao'), 5); assert.equal(slotOf(l, 'shaq'), -1);
  assert.deepEqual(copyLineup(l), l);
});

check('seeded shuffle: deterministic per seed, always a valid 3 + 3 of the six, user / kits kept', () => {
  const seed = 12345;
  const a = shuffle(resetLineup(), new Rng(seed ^ SHUFFLE_SEED_XOR));
  const b = shuffle(resetLineup(), new Rng(seed ^ SHUFFLE_SEED_XOR));
  assert.deepEqual(a, b);
  assert.equal(SHUFFLE_SEED_XOR, 0x5EED);
  const rng = new Rng(7);
  const seen = new Set();
  let l = setKits(setUser(resetLineup(), 'b'), 'classic');
  for (let i = 0; i < 300; i++) {
    l = shuffle(l, rng);
    assert.ok(validateLineup(l) && coversAllLegends(l));
    assert.equal(l.user, 'b'); assert.equal(l.kits, 'classic');
    seen.add(l.a.join(','));
  }
  assert.ok(seen.size > 60, 'shuffle variety ' + seen.size);
});

check('kit modes and team names (§5.12.3, C17)', () => {
  const def = resetLineup();
  assert.deepEqual(resolveKitModes(def), { a: 'classic', b: 'classic' });
  assert.deepEqual(teamNames(def), { a: 'dark', b: 'bright' });
  const flipped = { a: ['jordan', 'kobe', 'yao'], b: ['lebron', 'kyrie', 'giannis'], user: 'a', kits: 'classic' };
  assert.deepEqual(resolveKitModes(flipped), { a: 'classic', b: 'classic' });
  assert.deepEqual(teamNames(flipped), { a: 'bright', b: 'dark' });
  const allstarDefault = setKits(def, 'allstar');
  assert.deepEqual(resolveKitModes(allstarDefault), { a: 'allstarA', b: 'allstarB' });
  assert.deepEqual(teamNames(allstarDefault), { a: 'allstarA', b: 'allstarB' });
  const custom = swap(def, 4, 1);
  assert.deepEqual(resolveKitModes(custom), { a: 'allstarA', b: 'allstarB' });
  assert.deepEqual(teamNames(custom), { a: 'allstarA', b: 'allstarB' });
  assert.equal(kitClash(custom), false);
  const forced = setKits(custom, 'classic');
  assert.deepEqual(resolveKitModes(forced), { a: 'classic', b: 'classic' });
  assert.deepEqual(teamNames(forced), { a: 'allstarA', b: 'allstarB' });
  assert.equal(kitClash(forced), true);
  assert.equal(kitClash(setKits(def, 'classic')), false);
  assert.equal(entersAllStar(def, custom), true);
  assert.equal(entersAllStar(custom, swap(custom, 0, 5)), false);
  assert.equal(entersAllStar(custom, def), false);
  const byId = kitModeById(custom);
  assert.equal(byId.kobe, 'allstarA'); assert.equal(byId.kyrie, 'allstarB');
  const out = {};
  assert.equal(resolveKitModes(def, out), out);
});

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}
const throwing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); } };

check('persistence: round trip, invalid → default, throwing / missing storage → in-memory fallback', () => {
  clearLineupMemory();
  const st = memStorage();
  assert.deepEqual(loadLineup(st), resetLineup());
  const custom = setUser(setKits(swap(resetLineup(), 4, 1), 'allstar'), 'b');
  assert.equal(saveLineup(custom, st), true);
  assert.deepEqual(JSON.parse(st.m.get(LINEUP_STORAGE_KEY)), custom);
  assert.equal(LINEUP_STORAGE_KEY, 'legends3v3.lineup.v1');
  assert.deepEqual(loadLineup(st), custom);
  st.m.set(LINEUP_STORAGE_KEY, '{not json');
  assert.deepEqual(loadLineup(st), resetLineup());
  st.m.set(LINEUP_STORAGE_KEY, JSON.stringify({ a: ['kobe', 'kobe', 'yao'], b: ['jordan', 'lebron', 'kyrie'], user: 'a', kits: 'auto' }));
  assert.deepEqual(loadLineup(st), resetLineup());
  assert.equal(saveLineup({ a: ['x'], b: [] }, st), false);
  // throwing storage: save reports false, the value survives in memory for this session
  clearLineupMemory();
  assert.deepEqual(loadLineup(throwing), resetLineup());
  assert.equal(saveLineup(custom, throwing), false);
  assert.deepEqual(loadLineup(throwing), custom);
  assert.deepEqual(loadLineup(null), custom);
  // the default global path (Node has no usable localStorage here) never throws
  assert.doesNotThrow(() => loadLineup());
  assert.doesNotThrow(() => saveLineup(resetLineup()));
  clearLineupMemory();
});

check('URL: parseLineupParam / formatLineupParam / lineupFromQuery (session only)', () => {
  assert.deepEqual(parseLineupParam('lebron,kyrie,giannis~jordan,kobe,yao'), { a: ['lebron', 'kyrie', 'giannis'], b: ['jordan', 'kobe', 'yao'] });
  assert.deepEqual(parseLineupParam(' Kobe, kyrie ,giannis~jordan,lebron,YAO '), { a: ['kobe', 'kyrie', 'giannis'], b: ['jordan', 'lebron', 'yao'] });
  assert.equal(parseLineupParam('lebron,kyrie~jordan,kobe,yao,giannis'), null);
  assert.equal(parseLineupParam('lebron,lebron,giannis~jordan,kobe,yao'), null);
  assert.equal(parseLineupParam('lebron,kyrie,giannis'), null);
  assert.equal(parseLineupParam(null), null);
  const l = { a: ['kobe', 'kyrie', 'giannis'], b: ['jordan', 'lebron', 'yao'], user: 'a', kits: 'auto' };
  assert.deepEqual(parseLineupParam(formatLineupParam(l)), { a: l.a, b: l.b });
  const st = memStorage();
  clearLineupMemory();
  const q = lineupFromQuery('?lineup=kobe,kyrie,giannis~jordan,lebron,yao&user=b&kits=classic', resetLineup());
  assert.deepEqual(q, { a: ['kobe', 'kyrie', 'giannis'], b: ['jordan', 'lebron', 'yao'], user: 'b', kits: 'classic' });
  const bad = lineupFromQuery(new URLSearchParams('lineup=foo&user=z&kits=gold'), resetLineup());
  assert.deepEqual(bad, resetLineup());
  assert.equal(st.m.size, 0);   // nothing persisted
});

check('CPU check-ball receiver: normalised checkShare weights, max 3 consecutive checks (§5.12.4)', () => {
  const bright = ['jordan', 'kobe', 'yao'], dark = ['lebron', 'kyrie', 'giannis'];
  const wb = checkWeights(bright), wd = checkWeights(dark);
  near(wb[0], 0.55, 1e-12); near(wb[1], 0.40, 1e-12); near(wb[2], 0.05, 1e-12);
  near(wd[0], 0.50, 1e-12); near(wd[1], 0.40, 1e-12); near(wd[2], 0.10, 1e-12);
  // a custom roster renormalises
  const w = checkWeights(['yao', 'giannis', 'kobe']);
  near(w[0] + w[1] + w[2], 1, 1e-12); near(w[2], 0.40 / 0.55, 1e-12);
  // frequencies over many checks (streak rule active) and the streak cap itself
  const rng = new Rng(99);
  const st = makeCheckState();
  const counts = [0, 0, 0];
  let prev = -1, run = 0, maxRun = 0;
  for (let i = 0; i < 20000; i++) {
    const k = pickCheckReceiver(bright, rng, st);
    counts[k]++;
    run = k === prev ? run + 1 : 1; prev = k; maxRun = Math.max(maxRun, run);
  }
  assert.ok(maxRun <= 3, 'max consecutive ' + maxRun);
  assert.ok(counts[0] > counts[1] && counts[1] > counts[2] && counts[2] > 0, counts.join('/'));
  const st2 = { lastId: 'jordan', count: 3 };
  for (let i = 0; i < 50; i++) {
    const s = { lastId: 'jordan', count: 3 };
    assert.notEqual(pickCheckReceiver(bright, rng, s), 0);
  }
  assert.equal(st2.count, 3);
});

console.log(passed + ' checks passed');
