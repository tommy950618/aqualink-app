/* 忍界传说 · engine.js
 * Save/state, progression, gacha, campaign (推图), AFK income and the deterministic battle simulator.
 * Exposes NG.game and NG.battle — see CONTRACT.md §4.
 * Classic-script IIFE on window.NG. No DOM access: only localStorage (guarded, with an in-memory
 * fallback) so the whole engine also runs in node (tools/test-engine.js).
 *
 * Quick reference (beyond CONTRACT §4.2, all extras are optional helpers):
 *   NG.game.enemyPreview(stageId) -> [{id, lv, star, boss, hpMult, mult, c}]  (mult ≥ 1 scales hp/atk/def: fine-tuning
 *                                    between levels, or the elite factor beyond Lv400)
 *   NG.game.nextStage()           -> first uncleared (hence unlocked) stage id, or null when all cleared
 *   NG.game.chapterState(chId)    -> {unlocked, stars, maxStars, cleared, total}
 *   NG.game.idleRate()            -> {coins, exp, scrolls} per hour at current progress
 *   NG.game.expNeed(lv), setSetting(k,v), setFlag(k,v), setName(s), teamEntries(), stages(), skillLevel(id,k)
 *   NG.game.cfg (tunables, e.g. cfg.gemsPerPull, cfg.maxRounds), NG.game.econ
 *   Every mutation saves and emits NG.emit('change', {what, keys:[…], id?}).
 *   Battle record extras: timeout, maxRounds, summary {uid: {dmg, heal, taken, kills}}, stageId (battleStage).
 *   Event extras: round.rage (anti-stall bonus from round 13), dmg.absorbed / dmg.status, status.value,
 *   passive.key/on, revive.{maxHp, shield:0, chakra:0}; shield events have negative amount on expiry/dispel.
 */
(function (root) {
  'use strict';
  var NG = root.NG = root.NG || {};

  /* ============================================================================================
   * Utilities
   * ========================================================================================== */
  var hasOwn = Object.prototype.hasOwnProperty;
  function num(x, d) { return (typeof x === 'number' && isFinite(x)) ? x : d; }
  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function int(x, d) { return Math.floor(num(x, d)); }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  var warned = {};
  function warnOnce(key, msg) {
    if (warned[key]) return;
    warned[key] = 1;
    try { console.warn('[NG.engine] ' + msg); } catch (e) { /* no console */ }
  }

  /* mulberry32 with explicit, serialisable state */
  function Rng(seed) { this.s = seed >>> 0; }
  Rng.prototype.next = function () {
    var a = this.s = (this.s + 0x6D2B79F5) >>> 0;
    var t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Rng.prototype.int = function (n) { return Math.floor(this.next() * n); };
  Rng.prototype.chance = function (p) { return p >= 1 ? true : (p > 0 ? this.next() < p : false); };
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function toSeed(x) {
    if (typeof x === 'number' && isFinite(x)) return Math.floor(Math.abs(x)) >>> 0;
    if (typeof x === 'string' && x) return hashStr(x);
    return (Math.floor(Math.random() * 4294967296)) >>> 0;
  }
  function nice(n) { // round rewards to 3 significant digits
    n = Math.max(0, num(n, 0));
    if (n < 1000) return Math.round(n);
    var p = Math.pow(10, Math.floor(Math.log(n) / Math.LN10) - 2);
    return Math.round(n / p) * p;
  }

  /* ---------------- storage (localStorage, guarded; memory fallback) ---------------- */
  var memStore = {};
  function ls() { try { return root.localStorage || null; } catch (e) { return null; } }
  function storeGet(k) {
    var s = ls();
    if (s) { try { var v = s.getItem(k); if (v !== null && v !== undefined) return v; } catch (e) { /* fall back */ } }
    return hasOwn.call(memStore, k) ? memStore[k] : null;
  }
  function storeSet(k, v) {
    memStore[k] = v;
    var s = ls();
    if (s) { try { s.setItem(k, v); } catch (e) { /* quota / privacy mode: memory only */ } }
  }
  function storeDel(k) {
    delete memStore[k];
    var s = ls();
    if (s) { try { s.removeItem(k); } catch (e) { /* ignore */ } }
  }

  /* ============================================================================================
   * Tunables
   * ========================================================================================== */
  var CFG = {
    start: { coins: 100000000, gems: 20000, tickets: 1000, scrolls: 200 },
    starters: ['naruto'],          // given to a fresh save so the team is never empty
    gemsPerPull: 150,
    urPity: 90,
    lvGrowth: 0.06, starGrowth: 0.15, skillGrowth: 0.08,
    idleCap: 12 * 3600,            // seconds
    // battle
    defK: 500,                     // DEF mitigation: dmg × 1/(1 + DEF/(defK × defender growth))
    dmgScale: 1.0,
    roundTime: 10,                 // ATB time units per round (= one action of a spd-100 unit)
    maxRounds: 30,
    gauge: 1000,
    chakraAct: 25, chakraHit: 10, chakraMax: 100,
    baseCrit: 0.05, baseCritDmg: 1.5,
    bossTrue: 0.3,                 // bosses take 30% of true_dmg
    bossControl: 0.5,              // control chance multiplier vs bosses (engine extension)
    trueCapAtk: 4,                 // true_dmg is capped at 4×ATK of the caster
    maxTriggerDepth: 4,
    countersPerTurn: 2,            // a unit counterattacks at most twice between its own turns
    hitChakraPerTurn: 30,          // chakra gained from being hit is capped at +30 between own turns
    onHitPerTurn: 2,               // each on_hit trigger fires at most twice between own turns
    rageFrom: 12,                  // anti-stall: from this round on, damage +20%/round and healing −8%/round
    rageDmg: 0.2, rageHeal: 0.08
  };

  function maxSkillLv() { return NG.MAX_SKILL_LV || 10; }
  function maxStar() { return NG.MAX_STAR || 6; }
  function awakenStar() { return NG.AWAKEN_STAR || 4; }
  function levelCap(star) { var c = NG.STAR_LEVEL_CAP || [0, 100]; return c[clamp(star, 1, c.length - 1)] || 100; }
  function starForLevel(lv) {
    var caps = NG.STAR_LEVEL_CAP || [0, 100, 160, 220, 280, 340, 400];
    for (var s = 1; s < caps.length; s++) if (caps[s] >= lv) return s;
    return caps.length - 1;
  }
  function svOf(lv) { return 1 + CFG.skillGrowth * (clamp(int(lv, 1), 1, maxSkillLv()) - 1); }
  function skLv(e, k) { var s = e && e.skills; return clamp(int(s && s[k], 1), 1, maxSkillLv()); }
  function defaultSkills(lv) {
    var o = {}; (NG.SKILL_KEYS || ['passive', 's1', 's2', 'ult', 'awaken']).forEach(function (k) { o[k] = lv || 1; });
    return o;
  }
  function charOf(id) { return (NG.CHAR_MAP && NG.CHAR_MAP[id]) || null; }

  /* ============================================================================================
   * Stats & power
   * ========================================================================================== */
  var STAT_KEYS = ['hp', 'atk', 'def', 'spd', 'crit', 'critDmg', 'dodge', 'dr', 'dmg', 'lifesteal'];

  function addPassiveStats(acc, sk, sv) {
    if (!sk || !sk.stats || typeof sk.stats !== 'object') return;
    for (var k in sk.stats) {
      if (!hasOwn.call(sk.stats, k)) continue;
      if (!hasOwn.call(acc, k)) { warnOnce('pstat:' + k, 'unknown passive stat "' + k + '" ignored'); continue; }
      var v = num(sk.stats[k], 0);
      acc[k] += v > 0 ? v * sv : v;               // skill level only amplifies the positive parts
    }
  }

  function powerOf(s, e) {
    var sum = 0, keys = NG.SKILL_KEYS || ['passive', 's1', 's2', 'ult', 'awaken'];
    keys.forEach(function (k) { sum += svOf(skLv(e, k)); });
    var avgSv = sum / keys.length;
    var p = (s.hp * 0.25 + s.atk * 3.5 + s.def * 2) *
      (1 + (s.crit - CFG.baseCrit) * 0.6 + (s.critDmg - CFG.baseCritDmg) * 0.25 + s.dodge * 0.8 +
        s.dr * 1.0 + s.dmg * 0.8 + s.lifesteal * 0.5) *
      (0.6 + s.spd / 250) * (1 + 0.6 * (avgSv - 1));
    return Math.max(1, Math.round(p));
  }

  var NEG = { dmg: 1, true_dmg: 1, debuff: 1, status: 1, execute: 1, drain: 1, dispel: 1 };
  var SELF_DEFAULT = { chakra: 1, cleanse: 1, taunt: 1, counter: 1, immune: 1, lifesteal: 1 };
  var ENEMY_TARGET = { single: 1, all: 1, random: 1, lowest: 1, highest_atk: 1, back: 1 };
  var CONTROL_KEYS = ['stun', 'freeze', 'sleep', 'bind'];
  var DOT_KEYS = ['burn', 'poison', 'bleed'];
  var POSITIVE_ST = { taunt: 1, counter: 1, immune: 1 };
  function knownTarget(t) { return (NG.TARGETS || []).indexOf(t) >= 0; }
  function stKind(key) { var d = NG.STATUSES && NG.STATUSES[key]; return d ? d.kind : null; }
  /* ---------------- kit rating: how strong a character's skill kit is per action ----------------
   * Data agents scale multipliers with rarity, so pure stats under-rate strong kits. The rating is an
   * "ATK-multiplier equivalent per action" estimate; power is scaled by (kit/KIT_REF)^KIT_EXP. */
  var KIT = { ref: 2.0, exp: 0.7, min: 0.6, max: 1.8, freq: { s1: 0.55, s2: 0.28, ult: 0.17 },
    // empirical per-rarity factor: data kits scale with rarity beyond what the kit rating sees
    rarity: { UR: 1.15, SSR: 1.04, SR: 1.02, R: 1 } };
  var TRIG_RATE = { battle_start: 0.12, turn_start: 1, on_attack: 0.9, on_hit: 0.7, on_kill: 0.15, low_hp: 0.1, on_ult: 0.17, on_death: 0.08, on_ally_death: 0.2 };
  var BUFF_W = { atk: 1.5, dmg: 1.5, crit: 0.7, critDmg: 0.5, def: 1.0, dr: 1.3, spd: 1.2, dodge: 1.2 };
  function tFactor(target, count) {
    if (target === 'all' || target === 'ally_all') return 3;
    if (target === 'random' || target === 'ally_random') return Math.min(3, Math.max(1, num(count, 1)) * 0.75);
    return 1;
  }
  function effValue(e, skTf, enemyTargeting, isTrigger) {
    if (!e || typeof e !== 'object') return 0;
    var type = e.type, neg = !!NEG[type], tf;
    var to = e.to;
    if (to === 'ally_all' || to === 'enemy_all') tf = 3;
    else if (to === 'target') tf = isTrigger ? 1 : skTf;
    else if (to) tf = 1;
    else if (isTrigger || SELF_DEFAULT[type] || type === 'revive') tf = 1;
    else if (neg) tf = enemyTargeting ? skTf : 1;
    else tf = enemyTargeting ? 1 : skTf;
    var ch = clamp(num(e.chance, 1), 0, 1), turns = clamp(num(e.turns, 2), 1, 5), v = 0, k;
    switch (type) {
      case 'dmg': v = Math.max(0, num(e.mult, 1)) * clamp(num(e.hits, 1), 1, 10) * (1 + 0.3 * clamp(num(e.pierce, 0), 0, 1)); break;
      case 'true_dmg': v = clamp(num(e.pct, 0.1), 0, 0.5) * 10; break;
      case 'execute': v = Math.max(0, num(e.mult, 1)) * 0.35; break;
      case 'heal': v = typeof e.mult === 'number' ? e.mult * 0.8 : clamp(num(e.pct, 0.1), 0, 1) * 5; break;
      case 'shield': v = typeof e.mult === 'number' ? e.mult * 0.6 : clamp(num(e.pct, 0.1), 0, 1) * 4; break;
      case 'buff': v = clamp(num(e.value, 0.2), 0, 1.5) * num(BUFF_W[e.stat], 0.8) * turns; break;
      case 'debuff': v = clamp(num(e.value, 0.2), 0, 1.5) * num(BUFF_W[e.stat], 0.8) * turns * ch; break;
      case 'status':
        k = stKind(e.status); turns = clamp(num(e.turns, 1), 1, 5);
        if (k === 'control') v = ch * turns * (e.status === 'sleep' ? 0.8 : 1.6);
        else if (k === 'silence') v = ch * turns * 0.6;
        else if (k === 'dot') v = ch * turns * clamp(num(e.value, 0.3), 0, 2) * 1.4;
        break;
      case 'chakra': v = clamp(num(e.value, 10), 0, 100) / 100 * 3; break;
      case 'drain': v = clamp(num(e.value, 10), 0, 100) / 100 * 2.5; break;
      case 'cleanse': case 'dispel': v = 0.4; break;
      case 'revive': v = clamp(num(e.pct, 0.3), 0, 1) * 4; break;
      case 'taunt': v = 0.4 * turns; break;
      case 'counter': v = Math.max(0, num(e.mult, 0.5)) * turns * 0.5; break;
      case 'immune': v = 0.25 * turns; break;
      case 'lifesteal': v = clamp(num(e.value, 0), 0, 1) * 1.2; break;
    }
    return v * tf;
  }
  function skillValueEst(sk, isTrigger) {
    if (!sk || !Array.isArray(sk.effects)) return isTrigger ? 0 : 1;
    var tf = tFactor(sk.target, sk.count), et = !!ENEMY_TARGET[sk.target] || !knownTarget(sk.target), v = 0;
    sk.effects.forEach(function (e) { v += effValue(e, tf, et, isTrigger); });
    return v;
  }
  var kitCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function kitRating(c, star) {
    if (!c) return KIT.ref;
    var key = star >= awakenStar() ? 'A' : 'B', holder = c.skills && typeof c.skills === 'object' ? c.skills : null;
    var hit = kitCache && holder ? kitCache.get(holder) : null;
    if (hit && hit[key] !== undefined) return hit[key];
    var sks = c.skills || {}, v = 0;
    v += KIT.freq.s1 * (sks.s1 ? skillValueEst(sks.s1, false) : 1);
    v += KIT.freq.s2 * (sks.s2 ? skillValueEst(sks.s2, false) : 0);
    v += KIT.freq.ult * (sks.ult ? skillValueEst(sks.ult, false) : 0);
    [sks.passive, star >= awakenStar() ? sks.awaken : null].forEach(function (p) {
      if (!p || !Array.isArray(p.triggers)) return;
      p.triggers.forEach(function (tr) {
        if (!tr || !Array.isArray(tr.effects)) return;
        var rate = num(TRIG_RATE[tr.on], 0) * clamp(num(tr.chance, 1), 0, 1), tv = 0;
        tr.effects.forEach(function (e) { tv += effValue(e, 1, true, true); });
        v += rate * tv;
      });
    });
    if (kitCache && holder) { hit = hit || {}; hit[key] = v; kitCache.set(holder, hit); }
    return v;
  }
  function kitFactor(c, star) {
    return clamp(Math.pow(Math.max(0.1, kitRating(c, star)) / KIT.ref, KIT.exp), KIT.min, KIT.max) * num(KIT.rarity[c && c.rarity], 1);
  }

  /* c = character data, e = {lv, star, skills, hpMult?} */
  function calcStats(c, e) {
    e = e || {};
    var lv = clamp(int(e.lv, 1), 1, 9999);
    var star = clamp(int(e.star, 1), 1, maxStar());
    var rb = (NG.RARITY_BASE && NG.RARITY_BASE[c.rarity]) || { hp: 3800, atk: 370, def: 185 };
    var rm = (NG.ROLES && NG.ROLES[c.role]) || { hp: 1, atk: 1, def: 1 };
    var cs = c.stats || {};
    var g = (1 + CFG.lvGrowth * (lv - 1)) * (1 + CFG.starGrowth * (star - 1));
    var acc = { hp: 0, atk: 0, def: 0, spd: 0, crit: 0, critDmg: 0, dodge: 0, dr: 0, dmg: 0, lifesteal: 0 };
    var sks = c.skills || {};
    addPassiveStats(acc, sks.passive, svOf(skLv(e, 'passive')));
    if (star >= awakenStar()) addPassiveStats(acc, sks.awaken, svOf(skLv(e, 'awaken')));
    var hpMult = clamp(num(e.hpMult, 1), 0.1, 50);
    var sm = clamp(num(e.mult, 1), 0.1, 100);      // elite multiplier (campaign enemies beyond Lv cap)
    g *= sm;
    var s = {
      hp: Math.max(1, Math.round(num(rb.hp, 3800) * num(rm.hp, 1) * clamp(num(cs.hp, 1), 0.5, 2) * g * Math.max(0.2, 1 + acc.hp) * hpMult)),
      atk: Math.max(1, Math.round(num(rb.atk, 370) * num(rm.atk, 1) * clamp(num(cs.atk, 1), 0.5, 2) * g * Math.max(0.2, 1 + acc.atk))),
      def: Math.max(0, Math.round(num(rb.def, 185) * num(rm.def, 1) * clamp(num(cs.def, 1), 0.5, 2) * g * Math.max(0.2, 1 + acc.def))),
      spd: Math.max(20, Math.round(clamp(num(cs.spd, 100), 40, 200) * Math.max(0.3, 1 + acc.spd) + 2 * (star - 1))),
      crit: +clamp(CFG.baseCrit + acc.crit, 0, 1).toFixed(4),
      critDmg: +Math.max(1, CFG.baseCritDmg + acc.critDmg).toFixed(4),
      dodge: +clamp(acc.dodge, 0, 0.6).toFixed(4),
      dr: +clamp(acc.dr, -0.5, 0.6).toFixed(4),
      dmg: +clamp(acc.dmg, -0.5, 2).toFixed(4),
      lifesteal: +clamp(acc.lifesteal, 0, 1).toFixed(4)
    };
    s.power = Math.max(1, Math.round(powerOf(s, e) * kitFactor(c, star)));
    return s;
  }
  function zeroStats() { var o = {}; STAT_KEYS.forEach(function (k) { o[k] = 0; }); o.power = 0; return o; }

  /* reference UR used to define campaign difficulty (independent of data files) */
  var REF_UR = {
    id: '_ref', rarity: 'UR', role: 'ctrl', stats: { hp: 1, atk: 1, def: 1, spd: 112 },
    skills: {
      passive: { stats: { atk: 0.1, crit: 0.1 } },
      s1: { target: 'single', effects: [{ type: 'dmg', mult: 1.25 }] },
      s2: { target: 'all', cd: 3, effects: [{ type: 'dmg', mult: 0.85 }] },
      ult: { target: 'all', effects: [{ type: 'dmg', mult: 2.2 }, { type: 'status', status: 'stun', turns: 1, chance: 0.3 }] },
      awaken: { stats: { atk: 0.12 }, triggers: [{ on: 'on_ult', effects: [{ type: 'chakra', value: 20 }] }] }
    }
  };
  function skForLevel(lv) { return clamp(1 + Math.floor(lv / 45), 1, maxSkillLv()); }
  function refTeamPower(lv) {
    var l = Math.max(1, lv), star = starForLevel(Math.ceil(l)), g = 1 + CFG.lvGrowth * (l - 1);
    var base = calcStats(REF_UR, { lv: 1, star: star, skills: defaultSkills(skForLevel(l)) }).power;
    return 5 * base * g;
  }

  /* ============================================================================================
   * Battle simulator — NG.battle.simulate(teamA, teamB, {seed, maxRounds})
   * ========================================================================================== */
  var DEFAULT_S1 = { name: '普通攻击', fx: 'fist', target: 'single', cd: 0, effects: [{ type: 'dmg', mult: 1 }] };


  var checkedEff = typeof WeakSet === 'function' ? new WeakSet() : null;
  function checkEffects(list) {        // eager vocabulary check so unknown values warn once even if never cast
    (list || []).forEach(function (e) {
      if (!e || typeof e !== 'object' || (checkedEff && checkedEff.has(e))) return;
      if (checkedEff) checkedEff.add(e);
      if ((NG.EFFECT_TYPES || []).indexOf(e.type) < 0) warnOnce('eff:' + e.type, 'unknown effect type "' + e.type + '" ignored');
      if (e.to !== undefined && (NG.EFFECT_TO || []).indexOf(e.to) < 0) warnOnce('to:' + e.to, 'unknown effect "to" "' + e.to + '" → default');
      if ((e.type === 'buff' || e.type === 'debuff') && (NG.BUFF_STATS || []).indexOf(e.stat) < 0) warnOnce('bstat:' + e.stat, 'unknown ' + e.type + ' stat "' + e.stat + '" ignored');
      if (e.type === 'status' && !stKind(e.status)) warnOnce('status:' + e.status, 'unknown status "' + e.status + '" ignored');
    });
  }

  function cleanActive(sk, key, cid) {
    if (!sk || typeof sk !== 'object') return key === 's1' ? DEFAULT_S1 : null;
    var effects = Array.isArray(sk.effects) ? sk.effects.filter(function (e) { return e && typeof e === 'object'; }) : [];
    checkEffects(effects);
    if (!effects.length) {
      warnOnce('noeff:' + cid + ':' + key, cid + '.' + key + ' has no effects → plain attack');
      effects = DEFAULT_S1.effects;
    }
    var target = sk.target;
    if (!knownTarget(target)) {
      if (target !== undefined) warnOnce('target:' + target, 'unknown target "' + target + '" → single');
      target = 'single';
    }
    return {
      name: typeof sk.name === 'string' ? sk.name : (key === 's1' ? '普通攻击' : ''),
      fx: (NG.FX && NG.FX[sk.fx]) ? sk.fx : 'fist',
      target: target, count: clamp(int(sk.count, 1), 1, 5),
      cd: key === 's2' ? clamp(int(sk.cd, 3), 1, 6) : 0,
      effects: effects
    };
  }

  function simulate(teamA, teamB, opts) {
    opts = opts || {};
    var seed = toSeed(opts.seed);
    var rng = new Rng(seed);
    var maxRounds = clamp(int(opts.maxRounds, CFG.maxRounds), 1, 200);
    var events = [];
    var units = [];
    var byUid = {};
    var actor = null;        // unit whose turn is being processed
    var actSeq = 0;          // increments per turn / action (sleep-break bookkeeping)
    var depth = 0;           // trigger recursion depth
    var ended = false, winner = 'B', timeout = false;
    var deadA = {};
    var summary = {};

    function ev(o) { events.push(o); }
    var round = 0;
    function rageDmg() { return round > CFG.rageFrom ? 1 + CFG.rageDmg * (round - CFG.rageFrom) : 1; }
    function rageHeal() { return round > CFG.rageFrom ? Math.max(0.2, 1 - CFG.rageHeal * (round - CFG.rageFrom)) : 1; }

    /* ---------- build units ---------- */
    function build(list, side) {
      var pos = 0;
      (Array.isArray(list) ? list : []).forEach(function (en) {
        if (pos >= 5 || !en) return;
        var c = charOf(en.id);
        if (!c) { warnOnce('nochar:' + en.id, 'unknown character id "' + en.id + '" skipped in battle'); return; }
        var star = clamp(int(en.star, 1), 1, maxStar());
        var lv = clamp(int(en.lv, 1), 1, 9999);
        var entry = { lv: lv, star: star, skills: en.skills || defaultSkills(1), hpMult: en.hpMult, mult: en.mult };
        var st = calcStats(c, entry);
        var sks = c.skills || {};
        var u = {
          uid: side + pos, side: side, pos: pos, id: c.id, c: c,
          name: c.name || c.id, form: c.form || '', rarity: c.rarity, role: c.role,
          element: (NG.ELEMENTS && NG.ELEMENTS[c.element]) ? c.element : 'none',
          lv: lv, star: star, boss: !!en.boss,
          growth: (1 + CFG.lvGrowth * (lv - 1)) * (1 + CFG.starGrowth * (star - 1)) * clamp(num(en.mult, 1), 0.1, 100),
          base: st, maxHp: st.hp, hp: st.hp, chakra: 0, gauge: 0, alive: true,
          shields: [], buffs: [], st: {}, cd: 0, focus: null,
          sv: {}, sk: {}, trig: [],
          lowHpDone: false, deathDone: false, reviveUsed: false, counters: 0, hitChakra: 0
        };
        (NG.SKILL_KEYS || ['passive', 's1', 's2', 'ult', 'awaken']).forEach(function (k) { u.sv[k] = svOf(skLv(entry, k)); });
        u.sk.s1 = cleanActive(sks.s1, 's1', c.id) || DEFAULT_S1;
        u.sk.s2 = sks.s2 ? cleanActive(sks.s2, 's2', c.id) : null;
        u.sk.ult = sks.ult ? cleanActive(sks.ult, 'ult', c.id) : null;
        var addTriggers = function (sk, key) {
          if (!sk || !Array.isArray(sk.triggers)) return;
          sk.triggers.forEach(function (tr) {
            if (!tr || (NG.TRIGGERS || []).indexOf(tr.on) < 0) {
              warnOnce('trig:' + (tr && tr.on), 'unknown trigger "' + (tr && tr.on) + '" ignored');
              return;
            }
            var effs = Array.isArray(tr.effects) ? tr.effects.filter(function (e) { return e && typeof e === 'object'; }) : [];
            checkEffects(effs);
            if (!effs.length) return;
            u.trig.push({ on: tr.on, chance: tr.chance, effects: effs, name: sk.name || NG.SKILL_LABELS && NG.SKILL_LABELS[key] || '被动', key: key, sv: u.sv[key] });
          });
        };
        addTriggers(sks.passive, 'passive');
        if (star >= awakenStar()) addTriggers(sks.awaken, 'awaken');
        units.push(u); byUid[u.uid] = u;
        summary[u.uid] = { dmg: 0, heal: 0, taken: 0, kills: 0 };
        pos++;
      });
    }
    build(teamA, 'A');
    build(teamB, 'B');

    var snapshot = units.map(function (u) {
      return {
        uid: u.uid, side: u.side, pos: u.pos, id: u.id, name: u.name, form: u.form, rarity: u.rarity,
        role: u.role, element: u.element, lv: u.lv, star: u.star, maxHp: u.maxHp, hp: u.hp, chakra: 0,
        shield: 0, spd: u.base.spd, atk: u.base.atk, def: u.base.def, boss: u.boss
      };
    });

    /* ---------- helpers ---------- */
    function stat(u, k) {
      var b = u.base[k], add = 0, i;
      for (i = 0; i < u.buffs.length; i++) if (u.buffs[i].stat === k) add += u.buffs[i].value;
      switch (k) {
        case 'atk': return Math.max(1, b * clamp(1 + add, 0.3, 3.5));
        case 'def': return Math.max(0, b * clamp(1 + add, 0.2, 3.5));
        case 'spd': return Math.max(20, b * clamp(1 + add, 0.5, 3));
        case 'crit': return clamp(b + add, 0, 1);
        case 'critDmg': return Math.max(1, b + add);
        case 'dodge': return clamp(b + add, 0, 0.75);
        case 'dr': return clamp(b + add, -1, 0.8);
        case 'dmg': return clamp(b + add, -0.8, 4);
      }
      return num(b, 0);
    }
    function alive(side) { return units.filter(function (x) { return x.alive && x.side === side; }); }
    function enemiesOf(u) { return alive(u.side === 'A' ? 'B' : 'A'); }
    function alliesOf(u) { return alive(u.side); }
    function hpPct(x) { return x.hp / x.maxHp; }
    function minBy(arr, f) { var b = null, bv = Infinity; arr.forEach(function (x) { var v = f(x); if (v < bv) { bv = v; b = x; } }); return b; }
    function maxBy(arr, f) { var b = null, bv = -Infinity; arr.forEach(function (x) { var v = f(x); if (v > bv) { bv = v; b = x; } }); return b; }
    function pickN(arr, n) {
      var a = arr.slice(), out = [];
      while (out.length < n && a.length) out.push(a.splice(rng.int(a.length), 1)[0]);
      return out;
    }
    function pickAlive(arr) { var a = arr.filter(function (x) { return x.alive; }); return a.length ? a[rng.int(a.length)] : null; }
    function controlOf(u) { for (var i = 0; i < CONTROL_KEYS.length; i++) if (u.st[CONTROL_KEYS[i]]) return CONTROL_KEYS[i]; return null; }
    function shieldOf(u) { var s = 0; u.shields.forEach(function (x) { s += x.amt; }); return Math.round(s); }
    function sumOf(u) { return summary[u.uid]; }

    function focusOf(u) {
      var en = enemiesOf(u);
      if (!en.length) return null;
      var taunters = en.filter(function (x) { return x.st.taunt; });
      if (taunters.length) return minBy(taunters, function (x) { return x.pos; });
      if (!u.focus || !u.focus.alive || u.focus.side === u.side) {
        // sticky focus, chosen with a front-row bias: weight 5 for pos 0 … 1 for pos 4
        var tot = 0, i, w;
        for (i = 0; i < en.length; i++) tot += Math.max(1, 5 - en[i].pos);
        var roll = rng.next() * tot;
        u.focus = en[en.length - 1];
        for (i = 0; i < en.length; i++) { w = Math.max(1, 5 - en[i].pos); if (roll < w) { u.focus = en[i]; break; } roll -= w; }
      }
      return u.focus;
    }

    function skillTargets(u, sk) {
      var en, al, f;
      switch (sk.target) {
        case 'single': f = focusOf(u); return f ? [f] : [];
        case 'all': return enemiesOf(u);
        case 'random': return pickN(enemiesOf(u), sk.count);
        case 'lowest': en = enemiesOf(u); return en.length ? [minBy(en, hpPct)] : [];
        case 'highest_atk': en = enemiesOf(u); return en.length ? [maxBy(en, function (x) { return stat(x, 'atk'); })] : [];
        case 'back': en = enemiesOf(u); return en.length ? [maxBy(en, function (x) { return x.pos; })] : [];
        case 'self': return [u];
        case 'ally_lowest': al = alliesOf(u); return al.length ? [minBy(al, hpPct)] : [];
        case 'ally_all': return alliesOf(u);
        case 'ally_random': return pickN(alliesOf(u), sk.count);
      }
      f = focusOf(u); return f ? [f] : [];
    }

    function relevantOf(u, ctx) {
      if (ctx.relevant && ctx.relevant.alive && ctx.relevant.side !== u.side) return [ctx.relevant];
      var en = enemiesOf(u);
      if (!en.length) return [];
      ctx.relevant = en[rng.int(en.length)];
      return [ctx.relevant];
    }

    function deadAllies(u, ctx) {
      var d = units.filter(function (x) { return !x.alive && x.side === u.side && (x !== u || ctx.trigger === 'on_death'); });
      if (!d.length) return [];
      return [maxBy(d, function (x) { return x.base.power; })];
    }

    function effTargets(u, e, ctx) {
      var type = e.type, to = e.to, neg = !!NEG[type], al;
      if (to !== undefined && (NG.EFFECT_TO || []).indexOf(to) < 0) {
        warnOnce('to:' + to, 'unknown effect "to" "' + to + '" → default');
        to = undefined;
      }
      if (to === undefined) {
        if (type === 'revive') to = 'ally_dead';
        else if (SELF_DEFAULT[type]) return u.alive ? [u] : [];
        else if (ctx.trigger) return neg ? relevantOf(u, ctx) : (u.alive ? [u] : []);
        else if (neg) { if (ctx.enemyTargeting) return ctx.targets.filter(function (x) { return x.alive; }); var f = focusOf(u); return f ? [f] : []; }
        else return ctx.enemyTargeting ? (u.alive ? [u] : []) : ctx.targets.filter(function (x) { return x.alive; });
      }
      switch (to) {
        case 'target':
          if (ctx.trigger) return neg ? relevantOf(u, ctx) : (u.alive ? [u] : []);
          return ctx.targets.filter(function (x) { return x.alive; });
        case 'self': return (u.alive || type === 'revive') ? [u] : [];
        case 'ally_all': return alliesOf(u);
        case 'ally_lowest': al = alliesOf(u); return al.length ? [minBy(al, hpPct)] : [];
        case 'ally_random': return pickN(alliesOf(u), 1);
        case 'ally_dead': return deadAllies(u, ctx);
        case 'enemy_all': return enemiesOf(u);
        case 'enemy_random': return pickN(enemiesOf(u), 1);
        case 'attacker':
          if (ctx.attacker && ctx.attacker.alive) return [ctx.attacker];
          return neg ? (ctx.trigger ? relevantOf(u, ctx) : skillTargetsAlive(u, ctx)) : [];
      }
      return [];
    }
    function skillTargetsAlive(u, ctx) { return (ctx.targets || []).filter(function (x) { return x.alive && x.side !== u.side; }); }

    function advantage(a, d) {
      var ea = NG.ELEMENTS && NG.ELEMENTS[a.element];
      return !!(ea && ea.beats && ea.beats === d.element);
    }

    function calcHit(a, d, mult, pierce, sv) {
      var atk = stat(a, 'atk'), def = stat(d, 'def') * (1 - clamp(pierce, 0, 1));
      var v = atk * mult * sv * (1 + stat(a, 'dmg')) / (1 + def / (CFG.defK * d.growth)) * (1 - stat(d, 'dr')) * CFG.dmgScale;
      var adv = advantage(a, d);
      if (adv) v *= 1 + num(NG.ELEMENT_BONUS, 0.25);
      var crit = rng.chance(stat(a, 'crit'));
      if (crit) v *= stat(a, 'critDmg');
      v *= 0.95 + 0.1 * rng.next();
      return { amount: Math.max(1, Math.round(num(v, 1))), crit: crit, adv: adv };
    }

    function gain(t, v) {
      if (!t.alive) return;
      var nv = clamp(Math.round(t.chakra + num(v, 0)), 0, CFG.chakraMax);
      if (nv === t.chakra) return;
      t.chakra = nv;
      ev({ t: 'chakra', uid: t.uid, chakra: nv });
    }

    function heal(src, t, amt) {
      if (!t.alive) return 0;
      var real = Math.min(Math.round(num(amt, 0) * rageHeal()), t.maxHp - t.hp);
      if (!(real > 0)) return 0;
      t.hp += real;
      ev({ t: 'heal', src: src ? src.uid : null, uid: t.uid, amount: real, hp: t.hp });
      if (src) sumOf(src).heal += real;
      return real;
    }

    function addShield(t, amt, turns) {
      if (!t.alive) return;
      amt = Math.round(num(amt, 0));
      var room = t.maxHp - shieldOf(t);
      amt = Math.min(amt, room);
      if (!(amt > 0)) return;
      t.shields.push({ amt: amt, turns: clamp(int(turns, 2), 1, 5), fresh: t === actor });
      ev({ t: 'shield', uid: t.uid, amount: amt, shield: shieldOf(t) });
    }

    function absorb(t, amount) {
      var left = amount, got = 0;
      while (left > 0 && t.shields.length) {
        var s = t.shields[0], take = Math.min(s.amt, left);
        s.amt -= take; left -= take; got += take;
        if (s.amt <= 0) t.shields.shift();
      }
      return got;
    }

    function setStatus(t, key, data) {
      var cur = t.st[key];
      data.fresh = t === actor || !!(cur && cur.fresh);
      if (cur && cur.turns > data.turns) data.turns = cur.turns;
      t.st[key] = data;
      ev({ t: 'status', uid: t.uid, status: key, turns: data.turns });
    }
    function endStatus(t, key) {
      if (!t.st[key]) return;
      delete t.st[key];
      ev({ t: 'status_end', uid: t.uid, status: key });
    }

    function addBuff(src, t, stat_, value, turns) {
      var kind = value >= 0 ? 'buff' : 'debuff', name = kind + ':' + stat_, key = name + '@' + src.uid, cur = null, mx = turns;
      t.buffs.forEach(function (b) { if (b.key === key) cur = b; });
      if (cur) {
        if (Math.abs(value) > Math.abs(cur.value)) cur.value = value;
        cur.turns = Math.max(cur.turns, turns);
        cur.fresh = cur.fresh || t === actor;
      } else {
        t.buffs.push({ key: key, name: name, stat: stat_, value: value, turns: turns, fresh: t === actor });
      }
      t.buffs.forEach(function (b) { if (b.name === name && b.turns > mx) mx = b.turns; });
      ev({ t: 'status', uid: t.uid, status: name, turns: mx, value: +value.toFixed(3) });
    }
    function removeBuffs(t, pred) {
      var gone = {};
      t.buffs = t.buffs.filter(function (b) { if (pred(b)) { gone[b.name] = 1; return false; } return true; });
      Object.keys(gone).forEach(function (n) {
        if (!t.buffs.some(function (b) { return b.name === n; })) ev({ t: 'status_end', uid: t.uid, status: n });
      });
    }

    /* ---------- damage / death ---------- */
    function damage(src, t, amount, kind, info, ctx) {
      if (!t.alive) return 0;
      amount = Math.round(num(amount, 0) * rageDmg());
      if (!(amount > 0)) return 0;
      var absorbed = absorb(t, amount), before = t.hp;
      t.hp = Math.max(0, t.hp - (amount - absorbed));
      var eff = absorbed + (before - t.hp);
      var o = { t: 'dmg', src: src ? src.uid : null, uid: t.uid, amount: amount, crit: !!(info && info.crit), kind: kind, hp: t.hp, shield: shieldOf(t) };
      if (src && kind !== 'dot' && kind !== 'true') { o.el = src.element; if (info && info.adv) o.adv = true; }
      if (info && info.status) o.status = info.status;
      if (absorbed) o.absorbed = absorbed;
      ev(o);
      if (src) sumOf(src).dmg += eff;
      sumOf(t).taken += eff;
      if (ctx && ctx.act && src === ctx.act.actor) ctx.act.total += eff;
      if (t.st.sleep && t.st.sleep.act !== actSeq) endStatus(t, 'sleep');
      if (t.hp <= 0) die(t, src);
      else if (!t.lowHpDone && t.hp < 0.3 * t.maxHp) {
        t.lowHpDone = true;
        fire(t, 'low_hp', { attacker: src && src.side !== t.side ? src : null });
      }
      return eff;
    }

    function die(t, killer) {
      t.alive = false; t.hp = 0; t.shields = []; t.buffs = []; t.st = {}; t.chakra = 0; t.gauge = 0;
      ev({ t: 'death', uid: t.uid });
      if (t.side === 'A') deadA[t.uid] = 1;
      var foe = killer && killer.side !== t.side ? killer : null;
      if (foe) sumOf(foe).kills++;
      if (!t.deathDone) { t.deathDone = true; fire(t, 'on_death', { attacker: foe }); }
      units.forEach(function (x) { if (x.alive && x.side === t.side && x !== t) fire(x, 'on_ally_death', { attacker: foe }); });
      if (foe && foe.alive) fire(foe, 'on_kill', {});
    }

    function revive(t, pct) {
      t.alive = true;
      t.hp = clamp(Math.round(t.maxHp * clamp(num(pct, 0.3), 0.01, 1)), 1, t.maxHp);
      t.st = {}; t.buffs = []; t.shields = []; t.chakra = 0; t.gauge = 0;
      t.lowHpDone = t.hp < 0.3 * t.maxHp;
      ev({ t: 'revive', uid: t.uid, hp: t.hp, maxHp: t.maxHp, shield: 0, chakra: 0 });
    }

    function missed(u, t, ctx) {
      if (!ctx.act || ctx.trigger) return false;
      var m = ctx.act.miss;
      if (hasOwn.call(m, t.uid)) return m[t.uid];
      var d = !controlOf(t) && rng.chance(stat(t, 'dodge'));
      m[t.uid] = d;
      if (d) ev({ t: 'miss', src: u.uid, uid: t.uid });
      return d;
    }
    function markHit(ctx, t) {
      var a = ctx.act;
      if (!a || hasOwn.call(a.hitSet, t.uid) || t.side === a.actor.side) return;
      a.hitSet[t.uid] = 1; a.hits.push(t);
    }

    /* ---------- effect handlers ---------- */
    var H = {
      dmg: function (u, e, tg, ctx) {
        var mult = Math.max(0, num(e.mult, 1)), hits = clamp(int(e.hits, 1), 1, 10), pierce = clamp(num(e.pierce, 0), 0, 1);
        tg.forEach(function (t) {
          if (!t.alive || t.side === u.side || missed(u, t, ctx)) return;
          for (var h = 0; h < hits && t.alive; h++) {
            var r = calcHit(u, t, mult, pierce, ctx.sv);
            damage(u, t, r.amount, 'hit', r, ctx);
          }
          markHit(ctx, t);
        });
      },
      true_dmg: function (u, e, tg, ctx) {
        var pct = Math.min(clamp(num(e.pct, 0.1), 0, 0.5) * ctx.sv, 0.6);
        tg.forEach(function (t) {
          if (!t.alive || t.side === u.side || missed(u, t, ctx)) return;
          var v = pct * t.maxHp * (t.boss ? CFG.bossTrue : 1);
          v = Math.min(v, stat(u, 'atk') * CFG.trueCapAtk * ctx.sv);
          damage(u, t, v, 'true', null, ctx);
          markHit(ctx, t);
        });
      },
      heal: function (u, e, tg, ctx) {
        tg.forEach(function (t) {
          if (!t.alive || t.side !== u.side) return;
          var v = typeof e.mult === 'number' ? Math.max(0, num(e.mult, 1)) * stat(u, 'atk') * ctx.sv
            : clamp(num(e.pct, 0.1), 0, 1) * t.maxHp * ctx.sv;
          heal(u, t, v);
        });
      },
      shield: function (u, e, tg, ctx) {
        tg.forEach(function (t) {
          if (!t.alive || t.side !== u.side) return;
          var v = typeof e.mult === 'number' ? Math.max(0, num(e.mult, 0.3)) * stat(u, 'atk') * ctx.sv
            : clamp(num(e.pct, 0.1), 0, 1) * t.maxHp * ctx.sv;
          addShield(t, v, e.turns);
        });
      },
      buff: function (u, e, tg, ctx) {
        if ((NG.BUFF_STATS || []).indexOf(e.stat) < 0) { warnOnce('bstat:' + e.stat, 'unknown buff stat "' + e.stat + '" ignored'); return; }
        var v = clamp(num(e.value, 0.2), 0, 1.5) * (1 + 0.5 * (ctx.sv - 1)), turns = clamp(int(e.turns, 2), 1, 5);
        tg.forEach(function (t) { if (t.alive && t.side === u.side) addBuff(u, t, e.stat, v, turns); });
      },
      debuff: function (u, e, tg, ctx) {
        if ((NG.BUFF_STATS || []).indexOf(e.stat) < 0) { warnOnce('bstat:' + e.stat, 'unknown debuff stat "' + e.stat + '" ignored'); return; }
        var v = clamp(num(e.value, 0.2), 0, 1.5) * (1 + 0.5 * (ctx.sv - 1)), turns = clamp(int(e.turns, 2), 1, 5);
        var ch = clamp(num(e.chance, 1), 0, 1);
        tg.forEach(function (t) {
          if (!t.alive || t.side === u.side || missed(u, t, ctx)) return;
          if (!rng.chance(ch)) return;
          addBuff(u, t, e.stat, -v, turns);
        });
      },
      status: function (u, e, tg, ctx) {
        var key = e.status, kind = stKind(key);
        if (!kind) { warnOnce('status:' + key, 'unknown status "' + key + '" ignored'); return; }
        var isCtl = kind === 'control' || kind === 'silence';
        tg.forEach(function (t) {
          if (!t.alive || t.side === u.side || missed(u, t, ctx)) return;
          var ch = clamp(num(e.chance, 1), 0, 1);
          if (isCtl && t.st.immune) { ev({ t: 'passive', uid: t.uid, name: '免疫' }); return; }
          if (isCtl && t.boss) ch *= CFG.bossControl;
          if (!rng.chance(ch)) return;
          var turns = clamp(int(e.turns, 1), 1, 5), cur = t.st[key];
          var o = { turns: turns, src: u.uid, act: actSeq };
          if (kind === 'dot') {
            o.dmg = clamp(num(e.value, 0.3), 0, 2) * stat(u, 'atk') * ctx.sv;
            if (cur && cur.dmg > o.dmg) { o.dmg = cur.dmg; o.src = cur.src; }
          }
          setStatus(t, key, o);
        });
      },
      execute: function (u, e, tg, ctx) {
        var th = clamp(num(e.threshold, 0.3), 0.01, 0.99), mult = Math.max(0, num(e.mult, 1));
        tg.forEach(function (t) {
          if (!t.alive || t.side === u.side || hpPct(t) >= th || missed(u, t, ctx)) return;
          var r = calcHit(u, t, mult, 0, ctx.sv);
          damage(u, t, r.amount, 'execute', r, ctx);
          markHit(ctx, t);
        });
      },
      chakra: function (u, e, tg) {
        var v = clamp(num(e.value, 10), 0, 100);
        tg.forEach(function (t) { gain(t, v); });
      },
      drain: function (u, e, tg, ctx) {
        var v = clamp(num(e.value, 10), 0, 100);
        tg.forEach(function (t) {
          if (!t.alive || t.side === u.side || missed(u, t, ctx)) return;
          gain(t, -v);
        });
      },
      cleanse: function (u, e, tg) {
        tg.forEach(function (t) {
          if (!t.alive || t.side !== u.side) return;
          Object.keys(t.st).forEach(function (k) { if (!POSITIVE_ST[k]) endStatus(t, k); });
          removeBuffs(t, function (b) { return b.value < 0; });
        });
      },
      dispel: function (u, e, tg, ctx) {
        tg.forEach(function (t) {
          if (!t.alive || t.side === u.side || missed(u, t, ctx)) return;
          Object.keys(t.st).forEach(function (k) { if (POSITIVE_ST[k]) endStatus(t, k); });
          removeBuffs(t, function (b) { return b.value > 0; });
          var sh = shieldOf(t);
          if (sh > 0) { t.shields = []; ev({ t: 'shield', uid: t.uid, amount: -sh, shield: 0 }); }
        });
      },
      revive: function (u, e, tg) {
        if (u.reviveUsed) return;
        var t = tg.filter(function (x) { return !x.alive && x.side === u.side; })[0];
        if (!t) return;
        u.reviveUsed = true;
        revive(t, e.pct);
      },
      taunt: function (u, e, tg) {
        tg.forEach(function (t) { if (t.alive && t.side === u.side) setStatus(t, 'taunt', { turns: clamp(int(e.turns, 2), 1, 5) }); });
      },
      counter: function (u, e, tg, ctx) {
        tg.forEach(function (t) {
          if (t.alive && t.side === u.side) setStatus(t, 'counter', { turns: clamp(int(e.turns, 2), 1, 5), mult: Math.max(0, num(e.mult, 0.5)) * ctx.sv });
        });
      },
      immune: function (u, e, tg) {
        tg.forEach(function (t) { if (t.alive && t.side === u.side) setStatus(t, 'immune', { turns: clamp(int(e.turns, 2), 1, 5) }); });
      },
      lifesteal: function () { /* handled in applyEffect */ }
    };

    function applyEffect(u, e, ctx) {
      var type = e.type;
      if (!hasOwn.call(H, type)) { warnOnce('eff:' + type, 'unknown effect type "' + type + '" ignored'); return; }
      if (type === 'lifesteal') { if (ctx.act) ctx.act.ls += clamp(num(e.value, 0), 0, 1); return; }
      H[type](u, e, effTargets(u, e, ctx), ctx);
    }

    /* ---------- triggers ---------- */
    function fire(u, on, ctx) {
      if (depth >= CFG.maxTriggerDepth || !u.trig.length) return;
      for (var i = 0; i < u.trig.length; i++) {
        var tr = u.trig[i];
        if (tr.on !== on) continue;
        if (!u.alive && on !== 'on_death') return;
        if (on === 'on_hit' && (tr.fired || 0) >= CFG.onHitPerTurn) continue;
        if (tr.chance !== undefined && !rng.chance(clamp(num(tr.chance, 1), 0, 1))) continue;
        var c = { trigger: on, sv: tr.sv, attacker: ctx.attacker || null, act: ctx.act || null, relevant: ctx.relevant || ctx.attacker || null, targets: [] };
        if (on === 'on_hit') tr.fired = (tr.fired || 0) + 1;
        ev({ t: 'passive', uid: u.uid, name: tr.name, key: tr.key, on: on });
        depth++;
        try { for (var j = 0; j < tr.effects.length; j++) applyEffect(u, tr.effects[j], c); } finally { depth--; }
      }
    }

    /* ---------- actions & turns ---------- */
    function chooseSkill(u) {
      var silenced = !!u.st.silence;
      if (!silenced && u.sk.ult && u.chakra >= CFG.chakraMax) return 'ult';
      if (!silenced && u.sk.s2 && u.cd <= 0) return 's2';
      return 's1';
    }

    function performSkill(u, key) {
      var sk = u.sk[key] || u.sk.s1;
      actSeq++;
      if (key === 'ult') { u.chakra = 0; ev({ t: 'chakra', uid: u.uid, chakra: 0 }); }
      else if (key === 's2') u.cd = sk.cd;
      var targets = skillTargets(u, sk);
      ev({ t: 'act', uid: u.uid, skill: key, name: sk.name, fx: sk.fx, targets: targets.map(function (x) { return x.uid; }) });
      var act = { actor: u, key: key, targets: targets, hits: [], hitSet: {}, miss: {}, total: 0, ls: 0 };
      var ctx = { act: act, targets: targets, enemyTargeting: !!ENEMY_TARGET[sk.target], sv: u.sv[key] || 1 };
      for (var i = 0; i < sk.effects.length; i++) applyEffect(u, sk.effects[i], ctx);
      if (u.alive && act.hits.length) fire(u, 'on_attack', { act: act, relevant: pickAlive(act.hits) });
      var lsr = act.ls + stat(u, 'lifesteal');
      if (u.alive && lsr > 0 && act.total > 0) heal(u, u, act.total * Math.min(lsr, 1));
      if (key === 'ult' && u.alive) fire(u, 'on_ult', { relevant: pickAlive(targets.filter(function (x) { return x.side !== u.side; })) });
      if (key !== 'ult') gain(u, CFG.chakraAct);
      act.hits.forEach(function (t) {
        if (!t.alive) return;
        var room = CFG.hitChakraPerTurn - t.hitChakra;
        if (room > 0) { var g = Math.min(CFG.chakraHit, room); t.hitChakra += g; gain(t, g); }
        fire(t, 'on_hit', { attacker: u.alive ? u : null });
        if (t.alive && u.alive && t.st.counter && !controlOf(t) && t.counters < CFG.countersPerTurn) {
          t.counters++;
          var r = calcHit(t, u, t.st.counter.mult, 0, 1);
          damage(t, u, r.amount, 'counter', r, null);
        }
      });
    }

    function endTurn(u) {
      Object.keys(u.st).forEach(function (k) {
        var s = u.st[k];
        if (s.fresh) { s.fresh = false; return; }
        if (--s.turns <= 0) endStatus(u, k);
      });
      var gone = {};
      u.buffs = u.buffs.filter(function (b) {
        if (b.fresh) { b.fresh = false; return true; }
        if (--b.turns <= 0) { gone[b.name] = 1; return false; }
        return true;
      });
      Object.keys(gone).forEach(function (n) {
        if (!u.buffs.some(function (b) { return b.name === n; })) ev({ t: 'status_end', uid: u.uid, status: n });
      });
      var lost = 0;
      u.shields = u.shields.filter(function (s) {
        if (s.fresh) { s.fresh = false; return true; }
        if (--s.turns <= 0) { lost += s.amt; return false; }
        return true;
      });
      if (lost > 0) ev({ t: 'shield', uid: u.uid, amount: -Math.round(lost), shield: shieldOf(u) });
    }

    function takeTurn(u) {
      actor = u; actSeq++;
      u.counters = 0; u.hitChakra = 0;
      for (var q = 0; q < u.trig.length; q++) u.trig[q].fired = 0;
      if (u.cd > 0) u.cd--;
      for (var i = 0; i < DOT_KEYS.length && u.alive; i++) {
        var s = u.st[DOT_KEYS[i]];
        if (!s) continue;
        damage(byUid[s.src] || null, u, s.dmg * (1 - stat(u, 'dr')), 'dot', { status: DOT_KEYS[i] }, null);
      }
      if (u.alive) fire(u, 'turn_start', {});
      if (u.alive && enemiesOf(u).length) {
        var ctl = controlOf(u);
        if (ctl) ev({ t: 'skip', uid: u.uid, status: ctl });
        else performSkill(u, chooseSkill(u));
      }
      if (u.alive) endTurn(u);
      actor = null;
    }

    function checkEnd() {
      if (ended) return true;
      var a = alive('A').length > 0, b = alive('B').length > 0;
      if (a && b) return false;
      ended = true;
      winner = a && !b ? 'A' : 'B';
      return true;
    }

    /* ---------- main loop (ATB) ---------- */
    var time = 0;
    units.forEach(function (u) { u.gauge = rng.next() * 100; });
    units.slice().sort(function (x, y) { return (y.base.spd - x.base.spd) || (x.side < y.side ? -1 : x.side > y.side ? 1 : x.pos - y.pos); })
      .forEach(function (u) { if (u.alive) fire(u, 'battle_start', {}); });
    checkEnd();
    var guard = 0;
    while (!ended && guard++ < 50000) {
      var best = null, bestDt = Infinity;
      for (var i = 0; i < units.length; i++) {
        var u = units[i];
        if (!u.alive) continue;
        var dt = Math.max(0, (CFG.gauge - u.gauge) / stat(u, 'spd'));
        if (dt < bestDt - 1e-9) { bestDt = dt; best = u; }
      }
      if (!best) break;
      var nt = time + bestDt, r = Math.floor(nt / CFG.roundTime + 1e-9) + 1;
      if (r > maxRounds) { timeout = true; round = maxRounds; break; }
      for (var j = 0; j < units.length; j++) if (units[j].alive) units[j].gauge += stat(units[j], 'spd') * bestDt;
      time = nt;
      while (round < r) {
        round++;
        var ro = { t: 'round', n: round };
        if (round > CFG.rageFrom) ro.rage = +(rageDmg() - 1).toFixed(2);
        ev(ro);
      }
      best.gauge = 0;
      takeTurn(best);
      checkEnd();
    }
    if (!ended) { ended = true; winner = 'B'; timeout = true; }
    ev({ t: 'end', winner: winner });

    var deaths = Object.keys(deadA).length;
    return {
      winner: winner,
      rounds: Math.max(1, round),
      stars: winner === 'A' ? (deaths === 0 ? 3 : deaths <= 2 ? 2 : 1) : 0,
      seed: seed,
      timeout: timeout,
      maxRounds: maxRounds,
      units: snapshot,
      events: events,
      summary: summary
    };
  }

  NG.battle = {
    simulate: simulate,
    EVENT_TYPES: ['round', 'act', 'dmg', 'miss', 'heal', 'shield', 'status', 'status_end', 'chakra', 'skip', 'passive', 'death', 'revive', 'end'],
    rng: function (seed) { var r = new Rng(toSeed(seed)); return function () { return r.next(); }; }
  };

  /* ============================================================================================
   * Campaign (推图) — 14 chapters following the canon arcs (Naruto + Shippuden only)
   * Stage tuple: [name, desc, enemies ('!' marks the boss), bg override?]
   * ========================================================================================== */
  var CHAPTERS = [
    { name: '波之国', bg: 'mist', desc: '第七班迎来首个C级任务——护送造桥工人达兹纳返回波之国，却遭遇雾隐叛忍的截杀。', s: [
      ['禁术卷轴', '毕业考试落榜的鸣人被水木唆使偷出封印之书，伊鲁卡老师挺身相护。', ['mizuki'], 'village'],
      ['铃铛测试', '卡卡西的生存演习：日落之前夺下铃铛，才有资格成为真正的下忍。', ['kakashi'], 'forest'],
      ['鬼兄弟', '护送途中，雾隐中忍鬼兄弟从水洼中发动奇袭，锁链直取达兹纳。', ['gozu', 'meizu']],
      ['雾隐鬼人', '雾隐鬼人桃地再不斩现身，以水牢术困住了卡卡西。', ['zabuza']],
      ['神秘追忍', '戴着雾隐面具的追忍以千本“击杀”再不斩，将其带离战场。', ['haku']],
      ['桥上的浓雾', '大桥即将完工，浓雾之中杀气四伏，再不斩一伙再度来袭。', ['gozu', 'meizu', 'haku']],
      ['魔镜冰晶', '白发动秘术·魔镜冰晶，在冰镜之间穿梭，千本如暴雨般落下。', ['haku']],
      ['雷切', '卡卡西以忍犬困住再不斩，凝聚雷遁查克拉的雷切直取要害。', ['zabuza', 'haku']],
      ['大桥决战', '鸣人与佐助、卡卡西合力，在大桥之上与鬼人再不斩和白决一胜负。', ['!zabuza', 'haku']]
    ] },
    { name: '中忍考试', bg: 'forest', desc: '各国下忍齐聚木叶参加中忍考试，死亡森林中却潜伏着大蛇丸的阴谋。', s: [
      ['第一场·笔试', '森乃伊比喜主持的笔试暗藏玄机，最后一题考验的是忍者的觉悟。', ['ibiki'], 'village'],
      ['死亡森林', '御手洗红豆带领考生进入第四十四演习场，展开天地之书的争夺。', ['anko']],
      ['音忍奇袭', '音忍三人组袭击昏迷的佐助，小樱拼尽全力守护同伴。', ['dosu', 'zaku', 'kin']],
      ['草忍的真面目', '伪装成草忍的大蛇丸压制第七班，在佐助颈上留下了天之咒印。', ['orochimaru']],
      ['预选赛·心转身', '小樱与井野这对好友兼对手，在预选赛中展开宿命对决。', ['ino'], 'village'],
      ['预选赛·牙通牙', '鸣人对阵犬冢牙，以出其不意的战术逆转取胜。', ['kiba'], 'village'],
      ['预选赛·沙之盾', '李洛克打开八门遁甲，仍无法突破我爱罗的绝对防御。', ['gaara'], 'village'],
      ['通灵之术', '自来也将鸣人推下悬崖，生死关头鸣人借九尾查克拉通灵出蛤蟆文太，死死抓住它的背不放，终于得到了蛤蟆老大的认可。', ['gamabunta'], 'summon'],
      ['正赛·影子模仿术', '鹿丸以影子模仿术困住手鞠，却在胜利前主动认输。', ['temari'], 'village'],
      ['命运的牢笼', '正赛第一场，鸣人直面日向宁次，誓要打破所谓命运的牢笼。', ['!neji', 'rock_lee', 'tenten'], 'village']
    ] },
    { name: '木叶崩溃', bg: 'village', desc: '中忍考试正赛之际，砂隐与音隐联手发动“木叶崩溃计划”，三代目火影与大蛇丸展开殊死对决。', s: [
      ['月下密谈', '月光疾风撞破马基与兜的密谈，在月下的屋顶上壮烈牺牲。', ['baki', 'kabuto'], 'city_night'],
      ['涅槃精舍', '兜在会场施展幻术·涅槃精舍之术，羽毛飘落，观众纷纷陷入沉睡。', ['kabuto']],
      ['傀儡师', '油女志乃拦下勘九郎，寄坏虫对决傀儡术·乌鸦。', ['kankuro'], 'forest'],
      ['大镰鼬之术', '手鞠挥动巨扇，风遁·大镰鼬之术横扫整片森林。', ['temari'], 'forest'],
      ['四紫炎阵', '音忍四人众在屋顶布下紫色结界，将三代目火影与大蛇丸困在其中。', ['tayuya', 'kidomaru', 'jirobo', 'sakon']],
      ['秽土转生', '大蛇丸以禁术唤醒初代与二代火影，逼迫三代目与恩师兵刃相向。', ['hashirama', 'tobirama']],
      ['尸鬼封尽', '三代目火影以生命为代价召唤死神，封印了大蛇丸的双臂。', ['orochimaru']],
      ['砂之三姐弟', '佐助追击砂之三姐弟，我爱罗体内的守鹤逐渐失控。', ['gaara', 'temari', 'kankuro'], 'forest'],
      ['守鹤降临', '我爱罗化身一尾守鹤，鸣人通灵蛤蟆文太正面迎战。', ['!shukaku', 'gaara'], 'forest']
    ] },
    { name: '寻找纲手', bg: 'city_night', desc: '三代目逝去，自来也带着鸣人踏上寻找纲手的旅程，而晓的魔爪也伸向了九尾人柱力。', s: [
      ['晓的来访', '宇智波鼬与干柿鬼鲛潜入木叶，与阿斯玛、红正面交锋。', ['itachi', 'kisame'], 'village'],
      ['鲛肌', '鬼鲛的大刀鲛肌能削去查克拉，凯及时赶到挡下致命一击。', ['kisame']],
      ['月读', '佐助独自追来，在鼬的月读中经受七十二小时的折磨。', ['itachi']],
      ['螺旋丸修行', '自来也传授四代目火影的螺旋丸，三个阶段的修行正式开始。', ['jiraiya'], 'forest'],
      ['一指之赌', '鸣人向纲手发起挑战，却被她仅用一根手指弹飞。', ['tsunade', 'shizune']],
      ['逝者的幻影', '大蛇丸以复活绳树与断为交换条件，纲手眼前浮现出逝者的身影。', ['dan', 'nawaki']],
      ['药师兜', '兜撕下伪装，以查克拉手术刀切断鸣人的经络。', ['kabuto'], 'forest'],
      ['三忍之战', '传说中的三忍再度相遇，蛤蟆、蛞蝓与巨蛇的通灵大战一触即发。', ['!orochimaru', 'kabuto', 'manda'], 'forest']
    ] },
    { name: '佐助夺还', bg: 'valley', desc: '受咒印与力量的诱惑，佐助叛逃投奔大蛇丸。鹿丸率领下忍小队，踏上追回同伴的道路。', s: [
      ['音忍四人众', '音忍四人众接走佐助，鹿丸小队在森林中紧追不舍。', ['sakon', 'kidomaru', 'jirobo', 'tayuya'], 'forest'],
      ['土遁·土牢堂无', '丁次独自留下，以秋道一族的秘药对抗次郎坊。', ['jirobo'], 'forest'],
      ['蜘蛛战弓', '宁次以八卦掌回天迎击鬼童丸的蜘蛛丝与金弓。', ['kidomaru'], 'forest'],
      ['双魔之攻', '牙与赤丸迎战一体双魂的左近与右近，勘九郎及时赶来救援。', ['sakon'], 'forest'],
      ['魔笛·梦幻音锁', '多由也以魔笛操控三只怒鬼，手鞠及时现身支援鹿丸。', ['tayuya'], 'forest'],
      ['尸骨脉', '辉夜一族的末裔君麻吕，在醉拳李洛克面前展露骨之血继限界。', ['kimimaro']],
      ['咒印·状态2', '音忍五人众全部开启咒印状态2，力量暴涨。', ['kimimaro', 'sakon', 'kidomaru', 'jirobo', 'tayuya']],
      ['终末之谷', '初代火影与宇智波斑的雕像之下，鸣人与佐助迎来第一次决裂之战。', ['!sasuke']]
    ] },
    { name: '风影夺还', bg: 'desert', desc: '两年半后，修行归来的鸣人重返木叶。此时，晓的迪达拉与蝎掳走了五代目风影我爱罗。', s: [
      ['再战铃铛', '修行归来的鸣人与小樱，再次接受卡卡西的铃铛测试。', ['kakashi'], 'village'],
      ['天空的炸弹', '迪达拉驾驭黏土飞鸟，与风影我爱罗在砂隐上空激战。', ['deidara']],
      ['毒针傀儡', '勘九郎拦截赤砂之蝎，却中了傀儡绯流琥的剧毒。', ['sasori']],
      ['鬼鲛的复制体', '凯班在河边遭遇以替身之术现身的鬼鲛。', ['kisame'], 'forest'],
      ['鼬的替身', '鼬以替身拦截第七班，与鸣人展开周旋。', ['itachi'], 'forest'],
      ['三代目风影', '蝎操纵以三代目风影制成的人傀儡，砂铁之雨漫天落下。', ['sasori', 'kazekage_3']],
      ['百机操演', '千代与小樱面对蝎的最终奥义——赤秘技·百机操演。', ['sasori']],
      ['神威', '卡卡西以万花筒写轮眼的神威夺去迪达拉的一条手臂。', ['deidara']],
      ['赤砂之蝎', '与晓的二人组决战，夺回风影我爱罗！', ['!sasori', 'deidara']]
    ] },
    { name: '天地桥', bg: 'forest', desc: '大和与佐井加入新第七班，为接触蝎安插的间谍前往天地桥，却与大蛇丸不期而遇。', s: [
      ['新第七班', '初次见面的佐井便向鸣人出手，超兽伪画暗藏杀机。', ['sai'], 'village'],
      ['天地桥的间谍', '前来接头的竟是药师兜，大蛇丸也随之现身。', ['kabuto'], 'valley'],
      ['四尾化', '鸣人在愤怒中化身四尾，与大蛇丸展开毁天灭地的激战。', ['orochimaru'], 'valley'],
      ['根的密令', '团藏的根部暗中行动，佐井身负不为人知的密令。', ['sai', 'fu_yamanaka', 'torune']],
      ['重逢', '在大蛇丸的阿吉特中，时隔两年半的第七班与佐助终于重逢。', ['sasuke', 'orochimaru', 'kabuto']],
      ['八岐之术', '大蛇丸企图夺取佐助的身体，却在精神世界中被反噬。', ['orochimaru']],
      ['鬼灯水月', '佐助解放了被囚禁的鬼灯水月，水化之术令刀剑无效。', ['suigetsu']],
      ['南方阿吉特', '南方阿吉特的看守香燐，拥有感知查克拉的特殊能力。', ['karin']],
      ['北方阿吉特', '北方阿吉特中，咒印的源头——重吾的狂暴一触即发，失控的实验体蜂拥而出。', ['jugo', 'kabuto']],
      ['蛇小队', '佐助集结水月、香燐与重吾，组成了“蛇”小队。', ['!sasuke', 'suigetsu', 'karin', 'jugo']]
    ] },
    { name: '飞段与角都', bg: 'forest', desc: '晓的不死二人组袭击火之寺，猿飞阿斯玛战死，第十班誓要为师复仇。', s: [
      ['赏金猎人', '嗜钱如命的角都为了赏金四处猎杀忍者。', ['kakuzu'], 'city_night'],
      ['火之寺', '不死二人组袭击火之寺，守护忍十二士之一的地陆殒命。', ['hidan', 'kakuzu']],
      ['邪神教', '飞段以邪神教的诅咒仪式，将伤害转嫁到对手身上。', ['hidan']],
      ['阿斯玛之死', '阿斯玛的飞燕与飞段的三刃镰交锋，最终倒在诅咒之下。', ['hidan', 'kakuzu']],
      ['白绝的窥视', '绝潜伏在战场附近，记录着一切情报。', ['zetsu', 'zetsu']],
      ['奈良一族的森林', '鹿丸以计谋将飞段引入奈良一族的森林，将不死之身永远埋葬。', ['hidan']],
      ['地怨虞', '角都以地怨虞之术驱使体内的五颗心脏，五种性质查克拉接连发动。', ['kakuzu'], 'battlefield'],
      ['风遁·螺旋手里剑', '修行归来的鸣人以全新的风遁·螺旋手里剑，终结角都的不死之身。', ['!kakuzu', 'zetsu'], 'battlefield']
    ] },
    { name: '宇智波兄弟', bg: 'rain', desc: '佐助率领“蛇”小队四处搜寻宇智波鼬，兄弟二人终将在宇智波一族的据点决一死战。', s: [
      ['C2飞龙', '迪达拉驾驭C2飞龙，誓要以爆炸艺术击败写轮眼。', ['deidara'], 'forest'],
      ['艺术就是爆炸', '被逼入绝境的迪达拉化身炸弹，发动了最终的C0。', ['deidara', 'zetsu'], 'forest'],
      ['鬼鲛的拦截', '鬼鲛奉命拦住“蛇”小队，只放佐助一人通过。', ['kisame']],
      ['面具男阿飞', '自称阿飞的面具男现身，以时空间忍术阻挡第七班的追踪。', ['obito', 'zetsu'], 'forest'],
      ['回忆·瞬身止水', '鼬回忆起挚友宇智波止水，以及他托付的万花筒写轮眼。', ['shisui'], 'city_night'],
      ['回忆·灭族之夜', '宇智波一族策划政变，鼬在村子与家族之间做出了最痛苦的抉择。', ['fugaku', 'danzo'], 'city_night'],
      ['宇智波据点', '兄弟二人在宇智波据点重逢，写轮眼与写轮眼的幻术之战开始了。', ['itachi']],
      ['麒麟', '佐助引落天雷，以麒麟之术劈落苍穹。', ['itachi']],
      ['兄弟之战', '鼬展开须佐能乎，以十拳剑封印大蛇丸，最后轻点了佐助的额头。', ['!itachi']]
    ] },
    { name: '佩恩袭击', bg: 'rain', desc: '自来也孤身潜入雨隐村探查晓的首领，随后佩恩六道兵临木叶，誓要让世界“感受痛苦”。', s: [
      ['雨隐之里', '自来也潜入终年下雨的雨隐村，与晓的小南狭路相逢。', ['konan']],
      ['半神的传说', '山椒鱼半藏曾赐予三忍“传说”之名，也一手将雨隐推入战火。', ['hanzo']],
      ['晓的起源', '弥彦、长门与小南曾怀抱和平的理想，创立了最初的“晓”。', ['yahiko', 'konan']],
      ['佩恩六道', '自来也开启仙人模式，却发现佩恩六道共享着彼此的视野。', ['pain', 'konan']],
      ['自来也之死', '生命的最后一刻，自来也将佩恩的秘密刻在深作仙人的背上。', ['pain']],
      ['妙木山修行', '鸣人前往妙木山，在深作与志麻两位仙人的严格指导下修习仙术，稍有不慎便会化为蛤蟆石像。', ['fukasaku', 'shima'], 'forest'],
      ['木叶的劫难', '佩恩六道兵分多路袭击木叶，只为找出九尾人柱力。', ['pain', 'konan'], 'village'],
      ['卡卡西的牺牲', '卡卡西以神威对抗修罗道与天道，最终力竭倒下。', ['pain'], 'village'],
      ['神罗天征', '天道发动神罗天征，木叶在一瞬间被夷为平地。', ['pain', 'konan'], 'village'],
      ['仙人模式', '鸣人携仙术归来，在废墟之上与佩恩天道展开决战。', ['!pain', 'konan'], 'village']
    ] },
    { name: '五影会谈', bg: 'mist', desc: '佐助以晓的身份袭击八尾人柱力，五大国之影齐聚铁之国，一场会谈即将演变为风暴。', s: [
      ['雷犁热刀', '“鹰”小队袭击八尾人柱力奇拉比，雷遁与剑术的狂想曲奏响。', ['killer_b'], 'valley'],
      ['尾兽化·八尾', '奇拉比完全尾兽化，牛鬼的尾兽玉轰向“鹰”小队。', ['gyuki'], 'valley'],
      ['雷影之怒', '得知弟弟被掳的四代目雷影，带着护卫达鲁伊与希闯入会谈会场。', ['raikage_a', 'darui', 'c']],
      ['铁之国的武士', '中立的铁之国大将三船主持会谈，居合斩快如闪电。', ['mifune', 'darui']],
      ['尘遁', '三代目土影大野木以尘遁·原界剥离之术袭向佐助。', ['onoki', 'kurotsuchi', 'akatsuchi']],
      ['熔遁与沸遁', '五代目水影照美冥的熔遁腐蚀须佐能乎，长十郎与青随侍左右。', ['mei', 'ao', 'chojuro']],
      ['风影的劝说', '我爱罗试图唤醒佐助，以沙之盾挡下天照黑炎。', ['gaara_kazekage', 'temari', 'kankuro']],
      ['根之首领', '团藏从会场脱逃，在桥上遭到“鹰”的截击。', ['danzo', 'fu_yamanaka', 'torune']],
      ['伊邪那岐', '团藏右臂上的写轮眼接连闭合，伊邪那岐也无法改写结局。', ['danzo', 'torune', 'fu_yamanaka']],
      ['宣战', '面具男自称宇智波斑，向五大国宣告第四次忍界大战的开始。', ['!obito', 'sasuke_ms']]
    ] },
    { name: '第四次忍界大战·上', bg: 'battlefield', desc: '忍界联军五万人对阵晓与白绝大军，药师兜的秽土转生唤醒了一代代传奇忍者。', s: [
      ['征服九尾', '在岛龟的真实之瀑深处，鸣人直面九尾，在母亲玖辛奈的帮助下夺取其查克拉。', ['kurama'], 'summon'],
      ['白绝大军', '十万白绝自地底涌出，忍界联军各部队全面开战。', ['zetsu', 'zetsu', 'zetsu', 'zetsu']],
      ['忍刀七人众', '秽土转生的忍刀七人众重现战场，卡卡西再度面对再不斩与白。', ['zabuza', 'haku', 'kushimaru', 'jinpachi', 'jinin'], 'mist'],
      ['雾隐之刃', '鬼灯满月、林檎雨由利与西瓜山河豚鬼，雾隐的名刀再度出鞘。', ['mangetsu', 'ameyuri', 'fuguki'], 'mist'],
      ['金角银角', '拥有九尾查克拉的金银兄弟，以六道仙人的宝具封印对手。', ['kinkaku', 'ginkaku']],
      ['历代之影', '秽土转生的四位前代影，带着生前的绝技挡在五影面前。', ['mu', 'gengetsu', 'raikage_3', 'rasa'], 'desert'],
      ['人柱力的秽土', '前代人柱力被秽土转生，在带土的操纵下化身六道佩恩。', ['yagura', 'yugito', 'roshi', 'han', 'utakata']],
      ['长门与鼬', '秽土转生的长门与鼬出现在鸣人与奇拉比面前。', ['nagato', 'itachi_edo'], 'rain'],
      ['伊邪那美', '鼬与佐助联手对抗仙人模式的兜，以伊邪那美终结秽土转生。', ['kabuto_sage', 'kimimaro', 'jirobo', 'kidomaru'], 'city_night'],
      ['宇智波斑', '被秽土转生唤醒的宇智波斑降临战场，陨石自天而降。', ['!madara_edo']]
    ] },
    { name: '第四次忍界大战·下', bg: 'battlefield', desc: '尾兽现身战场，十尾复活，宇智波带土成为十尾人柱力，宇智波斑也迎来了真正的复活。', s: [
      ['尾兽现身', '带土以外道魔像操纵二尾、三尾与四尾，尾兽玉漫天飞舞。', ['matatabi', 'isobu', 'son_goku']],
      ['尾兽之怒', '五尾、六尾与七尾横扫联军阵地。', ['kokuo', 'saiken', 'chomei']],
      ['面具碎裂', '卡卡西的雷切劈开面具，背后竟是宇智波带土。', ['obito', 'zetsu', 'zetsu']],
      ['回忆·神无毗桥', '神无毗桥之战中，带土为救同伴被巨石压住，将写轮眼托付给卡卡西。', ['obito_kid', 'rin'], 'forest'],
      ['五影对斑', '宇智波斑以木遁分身与须佐能乎，一人压制五影。', ['madara_edo', 'zetsu', 'zetsu'], 'desert'],
      ['十尾复活', '外道魔像吸收八尾与九尾的部分查克拉，十尾降临战场。', ['juubi', 'obito']],
      ['十尾人柱力', '带土成为十尾人柱力，求道玉与六道之杖所向披靡，十尾分裂体铺天盖地。', ['obito_juubi', 'zetsu', 'zetsu', 'zetsu']],
      ['黑绝的寄生', '黑绝寄生于带土体内，强行夺走了他的身体。', ['black_zetsu', 'zetsu', 'zetsu']],
      ['外道·轮回天生', '斑借带土之手复活，夺取了十尾与外道魔像。', ['madara_edo', 'black_zetsu']],
      ['六道斑', '成为十尾人柱力的斑开启轮回写轮眼，月亮染上了血色。', ['!madara_sixpaths'], 'moon']
    ] },
    { name: '大筒木辉夜·终末之谷', bg: 'moon', desc: '黑绝千年的阴谋终于揭晓，查克拉之祖大筒木辉夜复活。封印之后，鸣人与佐助将在终末之谷了断宿命。', s: [
      ['宿命的源头', '六道仙人之子因陀罗与阿修罗，他们的转世之争延续了千年。', ['indra', 'asura'], 'summon'],
      ['六道仙人的试炼', '大筒木羽衣召见鸣人与佐助，授予二人六道之力。', ['hagoromo'], 'summon'],
      ['无限月读', '斑发动无限月读，全世界的人陷入永恒的梦境。', ['madara_sixpaths', 'black_zetsu']],
      ['黑绝的真相', '黑绝背刺斑，揭露自己正是辉夜意志的化身。', ['black_zetsu', 'zetsu', 'zetsu']],
      ['辉夜降临', '查克拉之祖大筒木辉夜复活，额上的轮回写轮眼缓缓睁开，白绝大军再度涌现。', ['kaguya', 'zetsu', 'zetsu']],
      ['异空间', '辉夜接连切换熔岩、冰原与重力空间，将第七班分散各处。', ['kaguya', 'zetsu']],
      ['共杀灰骨', '辉夜射出能令万物化为灰烬的共杀灰骨，带土以身挡下。', ['kaguya', 'black_zetsu']],
      ['月之守护', '与兄长共同封印辉夜的大筒木羽村，以转生眼审视着后世之人。', ['hamura']],
      ['六道·地爆天星', '鸣人与佐助合力发动六道·地爆天星，将辉夜再度封印。', ['kaguya', 'black_zetsu', 'zetsu', 'zetsu']],
      ['终末之谷', '宿命的终点，鸣人与佐助在终末之谷进行最后的对决。', ['!sasuke_rinnegan', 'indra'], 'valley']
    ] }
  ];

  // level a 5-UR team "should" have at the end of each chapter (drives enemy power & rewards)
  var CH_END_LV = [4, 15, 35, 60, 95, 120, 145, 170, 195, 220, 245, 270, 300, 330];
  // Recommended team power at the end of each chapter (geometric interpolation inside a chapter; stage 1-1
  // starts at ECON.firstPower). Fitted to a realistic-player simulation (`node tools/test-engine.js --sim-only 12`):
  // ch1–5 are a honeymoon for the 1000-pull opening team (≥1.7× the recommended power, no losses), from ch8 on
  // players arrive at ~1.03–1.07× of it (ch8–14 eased 2–6% after the player-like recalibration made the late
  // chapters bite); the whole campaign takes ≈2.1–2.6 h of active play at ×2 battle speed (≈4 h at ×1).
  var CH_END_POWER = [25000, 75000, 160000, 350000, 630000, 930000, 1220000, 1450000, 1736000, 1987000, 2280000, 2632000, 2952000, 3102000];
  // Per-stage enemy strength adjustment, fitted by `node tools/test-engine.js --calibrate` so that a
  // player-like team (5 URs — what the 1000-pull opening yields — stars 0–2 ahead of their level) at exactly
  // the recommended power wins ~78% of the time on every stage (kits such as dodge+self-heal solos or AoE vs
  // swarms are stronger/weaker than any power formula predicts). Missing ids = 1. Range [0.5, 2].
  var STAGE_ADJ = {
    '2-7': 1.3, '2-8': 1.3, '2-9': 0.92, '2-10': 0.93, '3-1': 1.12, '3-2': 1.68, '3-3': 0.98, '3-4': 0.91,
    '3-5': 1.2, '3-6': 1.04, '3-7': 0.93, '3-8': 1.17, '3-9': 1.13, '4-1': 1.19, '4-2': 1.44, '4-3': 1.08,
    '4-4': 1.02, '4-5': 1.23, '4-6': 1.12, '4-7': 1.31, '4-8': 1.06, '5-1': 1.16, '5-2': 1.5, '5-3': 1.11,
    '5-5': 0.98, '5-6': 0.84, '5-7': 1.13, '6-1': 1.01, '6-2': 0.84, '6-3': 1.05, '6-4': 1.3, '6-6': 0.99,
    '6-7': 0.98, '6-8': 0.81, '6-9': 0.89, '7-1': 1.03, '7-2': 1.18, '7-3': 0.9, '7-4': 1.15, '7-5': 1.04,
    '7-6': 0.98, '7-7': 0.76, '7-8': 1.17, '7-9': 0.9, '8-1': 1.01, '8-2': 1.05, '8-3': 1.06, '8-4': 1.03,
    '8-5': 1.09, '8-6': 1.01, '8-7': 0.98, '8-8': 0.99, '9-1': 0.78, '9-2': 0.85, '9-3': 1.24, '9-4': 1.04,
    '9-5': 0.87, '9-6': 1.09, '9-7': 1.05, '9-8': 1.05, '9-9': 1.11, '10-1': 0.86, '10-2': 1.19, '10-3': 0.83,
    '10-4': 1.01, '10-5': 0.96, '10-6': 1.14, '10-7': 1.02, '10-8': 0.98, '10-9': 1.04, '10-10': 0.98,
    '11-1': 0.8, '11-2': 1.42, '11-3': 0.99, '11-4': 0.96, '11-5': 1.2, '11-6': 0.92, '11-7': 1.11,
    '11-8': 1.08, '11-9': 1.03, '11-10': 1.05, '12-1': 0.79, '12-2': 0.9, '12-3': 1.24, '12-4': 1.01,
    '12-5': 1.02, '12-6': 1.12, '12-7': 1.24, '12-8': 0.91, '12-9': 0.99, '12-10': 0.95, '13-1': 1.16,
    '13-2': 1.03, '13-3': 1.16, '13-4': 1.25, '13-5': 0.99, '13-6': 1.22, '13-7': 0.92, '13-8': 1.14,
    '13-9': 0.95, '13-10': 1.47, '14-1': 0.87, '14-2': 1.31, '14-3': 1.21, '14-4': 1.08, '14-5': 1.08,
    '14-6': 1.23, '14-7': 1.15, '14-8': 1.22, '14-9': 0.99, '14-10': 1.04
  };
  var adjVersion = 0;
  var ECON = {
    firstPower: 2500,
    recoFactor: 1.0,      // recommended power = enemy power × this
    enemyFactor: 1.0,     // enemy power target = refTeamPower × this
    coinsFirst: 1.15,     // first clear pays this × the coin cost of the next lvEq step for 5 chars
    coinsRepeat: 0.25,    // repeat clears pay this × first-clear coins
    idleCoinsPerHour: 0.8 // AFK coins/h = this × first-clear coins of the best stage
  };

  function levelStepCost(L) { return Math.floor(400 + 55 * L * L); }        // coins for L → L+1
  function levelSpanCost(a, b) {                                             // continuous approx, 5 chars not included
    if (b <= a) return 0;
    return 400 * (b - a) + 55 / 3 * (b * b * b - a * a * a);
  }

  var _camp = null, _campKey = '';
  function campaignKey() { return (NG.CHARS ? NG.CHARS.length : 0) + '|' + JSON.stringify([CH_END_POWER, CH_END_LV, ECON, LINEUP, KIT, CFG.lvGrowth, adjVersion]); }

  function resolveEnemyIds(stageId, list) {
    var out = [];
    list.forEach(function (raw) {
      var boss = raw.charAt(0) === '!', id = boss ? raw.slice(1) : raw;
      if (charOf(id)) out.push({ id: id, boss: boss });
    });
    if (!out.length && NG.CHARS && NG.CHARS.length) {           // data missing → deterministic stand-ins
      var h = hashStr(stageId);
      for (var k = 0; k < Math.min(list.length, 3); k++) {
        var c = NG.CHARS[(h + k * 7919) % NG.CHARS.length];
        out.push({ id: c.id, boss: list[k].charAt(0) === '!' });
      }
    }
    return out;
  }

  // Lineup builder. Small lineups are stronger per power point (focus fire / AoE asymmetry), so measured
  // size factors are applied; solos/duos get extra strength mostly as HP so they rarely one-shot anyone.
  // The solver picks the enemy level; beyond Lv400 the level stays 400★6 and an elite `mult` (applied to
  // hp/atk/def and to DEF-mitigation growth, i.e. battle-equivalent to more levels) carries the rest.
  var ENEMY_MAX_LV = 999;
  var LINEUP = {
    sizeK: [1, 0.79, 0.85, 0.91, 0.99, 1.01],  // index = enemy count (measured, equal win rate per power)
    bossK: [1, 0.88, 0.99, 1.01, 0.99, 1.02],  // extra factor for boss lineups (control & true-dmg resist)
    hpBoost: [1, 2.6, 1.6, 1.2, 1.05, 1],
    ease: 0.85,                                   // < 1: at recommended power the player usually wins
    rarityK: { UR: 0.92, SSR: 1.0, SR: 0.97, R: 0.96 } // enemy-side correction by rarity (vs a UR/SSR player team)
  };
  function lineupPower(lineup, lv) {
    var star = starForLevel(Math.min(lv, levelCap(maxStar()))), sk = defaultSkills(skForLevel(lv)), sum = 0;
    lineup.forEach(function (x) {
      sum += calcStats(charOf(x.id), { lv: lv, star: star, skills: sk, hpMult: x.hpMult }).power;
    });
    return sum;
  }
  function solveLevel(lineup, target) {
    var maxLv = ENEMY_MAX_LV, lo = 1, hi = maxLv;
    if (lineupPower(lineup, maxLv) <= target) return maxLv;
    while (lo < hi) {                                             // largest lv with power <= target
      var mid = (lo + hi + 1) >> 1;
      if (lineupPower(lineup, mid) <= target) lo = mid; else hi = mid - 1;
    }
    if (lo < maxLv && Math.abs(lineupPower(lineup, lo + 1) - target) < Math.abs(lineupPower(lineup, lo) - target)) lo++;
    return lo;
  }
  /* ids: [{id, boss}] (existing chars); target: fair team power; bossHp: hpMult for the boss */
  function buildLineup(ids, target, bossHp) {
    var n = clamp(ids.length, 1, 5), boost = LINEUP.hpBoost[n], hasBoss = ids.some(function (x) { return x.boss; });
    var lineup = ids.map(function (x) {
      var hm = x.boss ? Math.min(3, bossHp * Math.sqrt(boost)) : boost;   // boss hpMult stays within 2–3
      return { id: x.id, boss: !!x.boss, hpMult: hm };
    });
    var rk = 0;
    ids.forEach(function (x) { var c = charOf(x.id); rk += num(LINEUP.rarityK[c && c.rarity], 1); });
    rk = ids.length ? rk / ids.length : 1;
    var t = target * LINEUP.sizeK[n] * (hasBoss ? LINEUP.bossK[n] : 1) * LINEUP.ease * rk;
    var lv = Math.min(solveLevel(lineup, t), levelCap(maxStar())), p = lineupPower(lineup, lv);
    if (p > t && lv > 1) { lv--; p = lineupPower(lineup, lv); }
    // Fine-tune with a small multiplier so the lineup lands exactly on the target power: a single level can
    // be a +16% jump at a star threshold (Lv100→101, …) and awakens unlock at ★4 (Lv220→221), which made a
    // few stages swing between "easy" and "wall". Beyond Lv400★6 the same multiplier is the elite factor.
    var mult = Math.round(t / Math.max(1, p) * 100) / 100;
    if (mult <= 1) mult = 1;
    var star = starForLevel(lv), sks = skForLevel(lv);
    return lineup.map(function (x) {
      var o = { id: x.id, lv: lv, star: star, boss: x.boss, skills: defaultSkills(sks) };
      if (x.hpMult !== 1) o.hpMult = Math.round(x.hpMult * 100) / 100;
      if (mult > 1) o.mult = mult;
      return o;
    });
  }

  function buildCampaign() {
    var key = campaignKey();
    if (_camp && _campKey === key) return _camp;
    var flat = [];
    CHAPTERS.forEach(function (ch, ci) { ch.s.forEach(function (st, si) { flat.push({ ci: ci, si: si, n: ch.s.length }); }); });
    var N = flat.length;
    function lvEqAt(gi) {
      if (gi >= N) return CH_END_LV[CH_END_LV.length - 1] + 3 * (gi - N + 1);
      var f = flat[gi], prev = f.ci ? CH_END_LV[f.ci - 1] : 1;
      return prev + (CH_END_LV[f.ci] - prev) * (f.si + 1) / f.n;
    }
    function targetPowerAt(g) {           // geometric interpolation between chapter-end anchors
      var f = flat[Math.min(g, N - 1)], end = CH_END_POWER[f.ci];
      var start = f.ci ? CH_END_POWER[f.ci - 1] : ECON.firstPower;
      var t = f.ci ? (f.si + 1) / f.n : f.si / Math.max(1, f.n - 1);
      return start * Math.pow(end / start, t);
    }
    var chapters = [], all = [], gi = 0;
    CHAPTERS.forEach(function (ch, ci) {
      var chOut = { id: 'ch' + (ci + 1), n: ci + 1, name: ch.name, desc: ch.desc, bg: ch.bg, stages: [] };
      var hpMult = Math.round((2 + ci / (CHAPTERS.length - 1)) * 10) / 10;        // 2.0 → 3.0
      ch.s.forEach(function (row, si) {
        var id = (ci + 1) + '-' + (si + 1);
        var isBoss = si === ch.s.length - 1;
        var lvE = lvEqAt(gi), lvN = lvEqAt(gi + 1);
        var target = targetPowerAt(gi) * ECON.enemyFactor;
        var lineup = resolveEnemyIds(id, row[2]).slice(0, 5);
        lineup.forEach(function (x) { if (!isBoss) x.boss = false; });
        if (isBoss && lineup.length && !lineup.some(function (x) { return x.boss; })) lineup[0].boss = true;
        var adj = clamp(num(STAGE_ADJ[id], 1), 0.5, 2);
        var enemies = lineup.length ? buildLineup(lineup, target * adj, hpMult) : [];
        var epow = 0;
        enemies.forEach(function (en) { epow += calcStats(charOf(en.id), en).power; });
        var span = levelSpanCost(Math.max(1, lvE), Math.max(lvE + 0.5, lvN)) * 5;
        var firstCoins = nice(span * ECON.coinsFirst + 20000 * (gi + 1));
        var stage = {
          id: id, chapter: chOut.id, ch: ci + 1, n: si + 1, index: gi,
          name: row[0], desc: row[1], bg: row[3] || ch.bg, boss: isBoss,
          enemies: enemies,
          power: Math.round(target * ECON.recoFactor),
          enemyPower: epow,
          lvEq: Math.round(lvE),
          rewards: {
            coins: nice(firstCoins * ECON.coinsRepeat), gems: 10 + (isBoss ? 20 : 0),
            scrolls: 2 + Math.floor(gi / 16), exp: 40 + 6 * gi
          },
          firstRewards: {
            coins: firstCoins, gems: 100 + 2 * gi + (isBoss ? 200 : 0),
            scrolls: 15 + Math.floor(gi / 3) + (isBoss ? 30 : 0),
            exp: 120 + 15 * gi, tickets: 10 + Math.floor(gi / 16) + (isBoss ? 30 : 0)
          }
        };
        chOut.stages.push(stage); all.push(stage);
        gi++;
      });
      chapters.push(chOut);
    });
    var map = {};
    all.forEach(function (s) { map[s.id] = s; });
    _camp = { chapters: chapters, stages: all, map: map };
    _campKey = key;
    return _camp;
  }

  /* ============================================================================================
   * Game state & API — NG.game
   * ========================================================================================== */
  var game = {};
  var S = null;           // current state
  var clock = function () { return Date.now(); };

  function defaultState() {
    var now = clock();
    return {
      v: 1, created: now, lastIdle: now,
      player: { name: '无名忍者', lv: 1, exp: 0 },
      coins: CFG.start.coins, gems: CFG.start.gems, tickets: CFG.start.tickets, scrolls: CFG.start.scrolls,
      roster: {},
      team: [],
      progress: {},
      pity: { ssr: 0, ur: 0 }, totalPulls: 0,
      flags: { welcomed: false },
      settings: { speed: 1, auto: true, rotate: 'auto', sound: false },
      rng: toSeed(null)
    };
  }
  function newEntry(now) { return { lv: 1, star: 1, shards: 0, skills: defaultSkills(1), obtained: now || clock() }; }

  function freshState() {
    var s = defaultState();
    CFG.starters.forEach(function (id) {
      if (charOf(id)) { s.roster[id] = newEntry(s.created); s.team.push(id); }
    });
    return s;
  }

  function normalize(s) {
    var d = defaultState();
    if (!s || typeof s !== 'object') return d;
    var o = {
      v: 1,
      created: num(s.created, d.created), lastIdle: num(s.lastIdle, d.lastIdle),
      player: {
        name: (s.player && typeof s.player.name === 'string' && s.player.name) ? s.player.name.slice(0, 16) : d.player.name,
        lv: Math.max(1, int(s.player && s.player.lv, 1)), exp: Math.max(0, int(s.player && s.player.exp, 0))
      },
      coins: Math.max(0, num(s.coins, d.coins)), gems: Math.max(0, num(s.gems, d.gems)),
      tickets: Math.max(0, int(s.tickets, d.tickets)), scrolls: Math.max(0, int(s.scrolls, d.scrolls)),
      roster: {}, team: [], progress: {},
      pity: { ssr: Math.max(0, int(s.pity && s.pity.ssr, 0)), ur: Math.max(0, int(s.pity && s.pity.ur, 0)) },
      totalPulls: Math.max(0, int(s.totalPulls, 0)),
      flags: {}, settings: {},
      rng: (typeof s.rng === 'number' && isFinite(s.rng)) ? (s.rng >>> 0) : d.rng
    };
    var flags = (s.flags && typeof s.flags === 'object') ? s.flags : {};
    Object.keys(d.flags).forEach(function (k) { o.flags[k] = d.flags[k]; });
    Object.keys(flags).forEach(function (k) { o.flags[k] = flags[k]; });
    var st = (s.settings && typeof s.settings === 'object') ? s.settings : {};
    Object.keys(d.settings).forEach(function (k) { o.settings[k] = hasOwn.call(st, k) ? st[k] : d.settings[k]; });
    Object.keys(st).forEach(function (k) { if (!hasOwn.call(o.settings, k)) o.settings[k] = st[k]; });
    var r = (s.roster && typeof s.roster === 'object') ? s.roster : {};
    Object.keys(r).forEach(function (id) {
      var e = r[id];
      if (!e || typeof e !== 'object') return;
      var star = clamp(int(e.star, 1), 1, maxStar());
      var sk = {};
      (NG.SKILL_KEYS || ['passive', 's1', 's2', 'ult', 'awaken']).forEach(function (k) { sk[k] = clamp(int(e.skills && e.skills[k], 1), 1, maxSkillLv()); });
      o.roster[id] = { lv: clamp(int(e.lv, 1), 1, levelCap(star)), star: star, shards: Math.max(0, int(e.shards, 0)), skills: sk, obtained: num(e.obtained, o.created) };
    });
    (Array.isArray(s.team) ? s.team : []).forEach(function (id) {
      if (o.roster[id] && o.team.indexOf(id) < 0 && o.team.length < 5) o.team.push(id);
    });
    var p = (s.progress && typeof s.progress === 'object') ? s.progress : {};
    Object.keys(p).forEach(function (k) { var v = clamp(int(p[k], 0), 0, 3); if (v > 0) o.progress[k] = v; });
    return o;
  }

  /* Saves from before a stage was inserted into a chapter (e.g. 2-8 通灵之术, 10-6 妙木山修行) can have
   * an uncleared stage in front of cleared ones; stages are only playable in order, so mark such gaps as
   * cleared (1★, no rewards) to keep "next stage" pointing at the real frontier. */
  function fillProgressGaps(s) {
    var list = buildCampaign().stages, last = -1, i;
    for (i = 0; i < list.length; i++) if (s.progress[list[i].id] > 0) last = i;
    for (i = 0; i < last; i++) if (!(s.progress[list[i].id] > 0)) s.progress[list[i].id] = 1;
  }

  function persist() {
    if (!S) return;
    try { storeSet(NG.SAVE_KEY || 'ng_save_v1', JSON.stringify(S)); } catch (e) { warnOnce('save', 'save failed: ' + e.message); }
  }
  function changed(what, keys, extra) {
    persist();
    var d = { what: what, keys: keys || [what] };
    if (extra) Object.keys(extra).forEach(function (k) { d[k] = extra[k]; });
    if (NG.emit) NG.emit('change', d);
  }
  function st() { if (!S) game.init(); return S; }

  game.init = function () {
    if (S) return S;
    var raw = storeGet(NG.SAVE_KEY || 'ng_save_v1'), loaded = null;
    if (raw) {
      try { var parsed = JSON.parse(raw); if (parsed && parsed.v === 1) loaded = normalize(parsed); }
      catch (e) { warnOnce('load', 'corrupt save ignored: ' + e.message); }
    }
    if (loaded) fillProgressGaps(loaded);
    S = loaded || freshState();
    persist();
    if (NG.emit) NG.emit('change', { what: 'init', keys: ['all'] });
    return S;
  };
  Object.defineProperty(game, 'state', {
    enumerable: true, configurable: true,
    get: function () { return st(); },
    set: function (v) { S = normalize(v); persist(); }
  });
  game.save = function () { st(); persist(); return true; };
  game.reset = function () {
    storeDel(NG.SAVE_KEY || 'ng_save_v1');
    S = freshState();
    changed('reset', ['all']);
    return S;
  };
  game.cfg = CFG;
  game.econ = ECON;
  game._setClock = function (fn) { clock = typeof fn === 'function' ? fn : function () { return Date.now(); }; };
  game._now = function () { return clock(); };

  /* ---------------- characters ---------------- */
  game.chars = function () { return NG.CHARS || []; };
  game.char = function (id) { return charOf(id); };
  game.owned = function (id) { var e = st().roster[id]; return e || null; };
  function entryOf(id, entry) {
    if (entry && typeof entry === 'object') return entry;
    return game.owned(id) || { lv: 1, star: 1, shards: 0, skills: defaultSkills(1) };
  }
  game.stats = function (id, entry) {
    var c = charOf(id);
    if (!c) return zeroStats();
    return calcStats(c, entryOf(id, entry));
  };
  game.power = function (id, entry) { return game.stats(id, entry).power; };
  game.teamPower = function () {
    var p = 0;
    st().team.forEach(function (id) { if (charOf(id) && S.roster[id]) p += game.power(id); });
    return p;
  };
  game.ownedList = function () {
    var r = st().roster, list = [];
    Object.keys(r).forEach(function (id) {
      var c = charOf(id);
      if (c) list.push({ id: id, c: c, e: r[id], power: calcStats(c, r[id]).power });
    });
    list.sort(function (a, b) {
      return (b.power - a.power) ||
        (((NG.RARITIES[b.c.rarity] || {}).order || 0) - ((NG.RARITIES[a.c.rarity] || {}).order || 0)) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
    return list;
  };

  /* ---------------- progression ---------------- */
  game.maxLevel = function (id) { var e = game.owned(id); return levelCap(e ? e.star : 1); };
  game.levelStepCost = levelStepCost;
  game.levelCost = function (id, n) {
    var e = game.owned(id), lv = e ? e.lv : 1, cap = levelCap(e ? e.star : 1);
    n = (n === 'max' || n === Infinity) ? cap : Math.max(0, int(n, 1));
    var to = Math.min(cap, lv + n), c = 0;
    for (var L = lv; L < to; L++) c += levelStepCost(L);
    return c;
  };
  game.levelUp = function (id, n) {
    var e = game.owned(id);
    if (!e) return { ok: false, gained: 0, cost: 0, reason: '未拥有该忍者' };
    var cap = levelCap(e.star);
    if (e.lv >= cap) return { ok: false, gained: 0, cost: 0, reason: e.star >= maxStar() ? '已达最高等级' : '已达等级上限，请先升星' };
    n = (n === 'max' || n === Infinity) ? cap : Math.max(1, int(n, 1));
    var gained = 0, cost = 0;
    while (gained < n && e.lv < cap) {
      var c = levelStepCost(e.lv);
      if (S.coins < c) break;
      S.coins -= c; cost += c; e.lv++; gained++;
    }
    if (!gained) return { ok: false, gained: 0, cost: 0, reason: '铜币不足' };
    changed('roster', ['coins', 'roster'], { id: id });
    return { ok: true, gained: gained, cost: cost, lv: e.lv, reason: '' };
  };
  game.starCost = function (id) {
    var e = game.owned(id);
    if (!e || e.star >= maxStar()) return null;
    return (NG.STAR_SHARD_COST || [])[e.star] || null;
  };
  game.starUp = function (id) {
    var e = game.owned(id);
    if (!e) return { ok: false, reason: '未拥有该忍者' };
    var c = game.starCost(id);
    if (c == null) return { ok: false, reason: '已达最高星级' };
    if (e.shards < c) return { ok: false, reason: '碎片不足（' + e.shards + '/' + c + '）' };
    e.shards -= c; e.star++;
    changed('roster', ['roster'], { id: id });
    return { ok: true, star: e.star, reason: '', awakened: e.star === awakenStar() };
  };
  game.skillUnlocked = function (id, key) {
    if ((NG.SKILL_KEYS || []).indexOf(key) < 0) return false;
    if (key !== 'awaken') return true;
    var e = game.owned(id);
    return !!e && e.star >= awakenStar();
  };
  game.skillLevel = function (id, key) { return skLv(game.owned(id), key); };
  game.skillCost = function (id, key) {
    if ((NG.SKILL_KEYS || []).indexOf(key) < 0) return null;
    var lv = skLv(game.owned(id), key);
    if (lv >= maxSkillLv()) return null;
    return { coins: 100000 * lv, scrolls: 5 * lv };
  };
  game.skillUp = function (id, key) {
    var e = game.owned(id);
    if (!e) return { ok: false, reason: '未拥有该忍者' };
    if ((NG.SKILL_KEYS || []).indexOf(key) < 0) return { ok: false, reason: '未知技能' };
    if (!game.skillUnlocked(id, key)) return { ok: false, reason: '★' + awakenStar() + '解锁' };
    var c = game.skillCost(id, key);
    if (!c) return { ok: false, reason: '技能已满级' };
    if (S.coins < c.coins) return { ok: false, reason: '铜币不足' };
    if (S.scrolls < c.scrolls) return { ok: false, reason: '忍术卷轴不足' };
    S.coins -= c.coins; S.scrolls -= c.scrolls;
    e.skills[key] = skLv(e, key) + 1;
    changed('roster', ['coins', 'scrolls', 'roster'], { id: id });
    return { ok: true, lv: e.skills[key], reason: '' };
  };
  game.skillValue = function (id, key) { return svOf(skLv(game.owned(id), key)); };

  /* ---------------- gacha ---------------- */
  game.rates = function () {
    var R = NG.RARITIES || {};
    return { UR: num(R.UR && R.UR.rate, 0.015), SSR: num(R.SSR && R.SSR.rate, 0.085), SR: num(R.SR && R.SR.rate, 0.3), R: num(R.R && R.R.rate, 0.6) };
  };
  game.pityInfo = function () { var s = st(); return { ssr: s.pity.ssr, ur: s.pity.ur, urPity: CFG.urPity, left: CFG.urPity - s.pity.ur }; };

  function pools() {
    var p = { UR: [], SSR: [], SR: [], R: [] };
    (NG.CHARS || []).forEach(function (c) { if (p[c.rarity]) p[c.rarity].push(c); });
    return p;
  }
  function pickFromPool(P, rar, rng) {
    var order = ['UR', 'SSR', 'SR', 'R'], i0 = order.indexOf(rar), list = P[rar];
    if (!list || !list.length) {                 // missing rarity → nearest available (prefer lower)
      for (var d = 1; d < 4 && (!list || !list.length); d++) {
        if (i0 + d < 4 && P[order[i0 + d]].length) list = P[order[i0 + d]];
        else if (i0 - d >= 0 && P[order[i0 - d]].length) list = P[order[i0 - d]];
      }
    }
    return list && list.length ? list[rng.int(list.length)] : null;
  }
  function rollRarity(rng, rates, forceSSR) {
    var s = S;
    if (s.pity.ur >= CFG.urPity - 1) return 'UR';
    var x = rng.next();
    if (forceSSR) return x < rates.UR / (rates.UR + rates.SSR) ? 'UR' : 'SSR';
    if (x < rates.UR) return 'UR';
    if (x < rates.UR + rates.SSR) return 'SSR';
    if (x < rates.UR + rates.SSR + rates.SR) return 'SR';
    return 'R';
  }
  game.summon = function (n) {
    var s = st();
    n = int(n, 0);
    if ([1, 10, 100].indexOf(n) < 0) return { ok: false, reason: '无效的召唤次数', results: [] };
    var P = pools();
    if (!(P.UR.length + P.SSR.length + P.SR.length + P.R.length)) return { ok: false, reason: '暂无可召唤的忍者', results: [] };
    var useT = Math.min(s.tickets, n), gems = (n - useT) * CFG.gemsPerPull;
    if (s.gems < gems) return { ok: false, reason: '招募券和勾玉不足', results: [], need: { tickets: n, gems: gems } };
    s.tickets -= useT; s.gems -= gems;
    var rng = new Rng(s.rng), rates = game.rates(), now = clock(), results = [];
    var batch = n === 1 ? 1 : 10;
    for (var b = 0; b < n / batch; b++) {
      var gotSSR = false;
      for (var i = 0; i < batch; i++) {
        var force = batch === 10 && i === 9 && !gotSSR;
        var rar = rollRarity(rng, rates, force);
        var c = pickFromPool(P, rar, rng);
        if (!c) continue;
        var real = c.rarity;
        if (real === 'UR') { s.pity.ur = 0; s.pity.ssr = 0; }
        else if (real === 'SSR') { s.pity.ur++; s.pity.ssr = 0; }
        else { s.pity.ur++; s.pity.ssr++; }
        if (real === 'UR' || real === 'SSR') gotSSR = true;
        var e = s.roster[c.id], isNew = !e, sh = 0;
        if (isNew) s.roster[c.id] = newEntry(now);
        else { sh = num((NG.RARITIES[real] || {}).dupShards, 20); e.shards += sh; }
        results.push({ id: c.id, rarity: real, isNew: isNew, shards: sh });
      }
    }
    s.rng = rng.s;
    s.totalPulls += n;
    if (s.team.length < 5) autoTeamInner();
    changed('summon', ['tickets', 'gems', 'roster', 'pity', 'team']);
    return { ok: true, reason: '', results: results, cost: { tickets: useT, gems: gems } };
  };

  /* ---------------- team ---------------- */
  game.setTeam = function (ids) {
    var s = st(), out = [];
    (Array.isArray(ids) ? ids : []).forEach(function (id) {
      if (s.roster[id] && charOf(id) && out.indexOf(id) < 0 && out.length < 5) out.push(id);
    });
    s.team = out;
    changed('team', ['team']);
    return out.slice();
  };
  var ROLE_ORDER = { tank: 0, atk: 1, ctrl: 2, sup: 3, heal: 4 };
  function autoTeamInner() {
    var top = game.ownedList().slice(0, 5);
    top.sort(function (a, b) { return (num(ROLE_ORDER[a.c.role], 2) - num(ROLE_ORDER[b.c.role], 2)) || (b.power - a.power); });
    S.team = top.map(function (x) { return x.id; });
    return S.team;
  }
  game.autoTeam = function () { st(); autoTeamInner(); changed('team', ['team']); return S.team.slice(); };
  game.teamEntries = function () {
    var s = st();
    return s.team.filter(function (id) { return s.roster[id] && charOf(id); }).map(function (id) {
      var e = s.roster[id];
      return { id: id, lv: e.lv, star: e.star, skills: copy(e.skills) };
    });
  };

  /* ---------------- campaign ---------------- */
  game.chapters = function () { return buildCampaign().chapters; };
  game.stages = function () { return buildCampaign().stages; };
  game.stage = function (id) { return buildCampaign().map[id] || null; };
  game.stageState = function (id) {
    var c = buildCampaign(), stg = c.map[id], s = st();
    if (!stg) return { unlocked: false, stars: 0, cleared: false };
    var prev = stg.index > 0 ? c.stages[stg.index - 1] : null;
    var stars = s.progress[id] || 0;
    return { unlocked: !prev || (s.progress[prev.id] || 0) > 0, stars: stars, cleared: stars > 0 };
  };
  game.chapterState = function (chId) {
    var ch = null;
    game.chapters().forEach(function (c) { if (c.id === chId || c.n === chId) ch = c; });
    if (!ch) return { unlocked: false, stars: 0, maxStars: 0, cleared: 0, total: 0 };
    var s = st(), stars = 0, cleared = 0;
    ch.stages.forEach(function (x) { var v = s.progress[x.id] || 0; stars += v; if (v) cleared++; });
    return { unlocked: game.stageState(ch.stages[0].id).unlocked, stars: stars, maxStars: ch.stages.length * 3, cleared: cleared, total: ch.stages.length };
  };
  game.nextStage = function () {
    var list = buildCampaign().stages, s = st();
    for (var i = 0; i < list.length; i++) if (!(s.progress[list[i].id] > 0)) return list[i].id;
    return null;
  };
  game.enemyPreview = function (id) {
    var stg = game.stage(id);
    if (!stg) return [];
    return stg.enemies.map(function (e) { return { id: e.id, lv: e.lv, star: e.star, boss: !!e.boss, hpMult: e.hpMult || 1, mult: e.mult || 1, c: charOf(e.id) }; });
  };
  game.battleStage = function (id, seed) {
    var stg = game.stage(id);
    if (!stg) return null;
    var rec = simulate(game.teamEntries(), copy(stg.enemies), { seed: seed == null ? undefined : seed, maxRounds: CFG.maxRounds });
    rec.stageId = id;
    return rec;
  };
  game.expNeed = function (lv) { return 200 * Math.max(1, int(lv, 1)); };
  function grant(rw) {
    var s = S, got = {}, lvUps = 0;
    ['coins', 'gems', 'tickets', 'scrolls'].forEach(function (k) {
      var v = Math.max(0, Math.floor(num(rw[k], 0)));
      if (v) { s[k] += v; got[k] = v; }
    });
    var ex = Math.max(0, Math.floor(num(rw.exp, 0)));
    if (ex) {
      got.exp = ex;
      s.player.exp += ex;
      while (s.player.exp >= game.expNeed(s.player.lv) && s.player.lv < 999) { s.player.exp -= game.expNeed(s.player.lv); s.player.lv++; lvUps++; }
    }
    return { got: got, lvUps: lvUps };
  }
  function addRewards(a, b) {
    var o = {};
    [a, b].forEach(function (r) { Object.keys(r || {}).forEach(function (k) { if (num(r[k], 0)) o[k] = (o[k] || 0) + r[k]; }); });
    return o;
  }
  game.finishStage = function (id, record) {
    var stg = game.stage(id), s = st();
    var fail = { win: false, stars: 0, rewards: {}, firstClear: false };
    if (!stg || !record) { fail.reason = '关卡不存在'; return fail; }
    if (record.stageId && record.stageId !== id) { fail.reason = '战斗记录与关卡不符'; return fail; }
    if (record.winner !== 'A') return fail;
    if (!game.stageState(id).unlocked) { fail.reason = '关卡未解锁'; return fail; }
    if (record._claimed) { fail.win = true; fail.stars = record.stars; fail.reason = '奖励已领取'; return fail; }
    record._claimed = true;
    var stars = clamp(int(record.stars, 1), 1, 3);
    var firstClear = !(s.progress[id] > 0);
    s.progress[id] = Math.max(s.progress[id] || 0, stars);
    var rw = firstClear ? addRewards(stg.rewards, stg.firstRewards) : addRewards(stg.rewards, {});
    var g = grant(rw);
    changed('progress', ['progress', 'coins', 'gems', 'tickets', 'scrolls', 'player'], { id: id });
    return { win: true, stars: stars, rewards: g.got, firstClear: firstClear, playerLvUp: g.lvUps, next: game.nextStage() };
  };

  /* ---------------- AFK income ---------------- */
  function bestClearedIndex() {
    var list = buildCampaign().stages, s = st(), k = -1;
    for (var i = 0; i < list.length; i++) if (s.progress[list[i].id] > 0) k = i;
    return k;
  }
  game.idleRate = function () {        // per hour
    var k = bestClearedIndex(), list = buildCampaign().stages;
    if (k < 0) return { coins: 300000, exp: 150, scrolls: 10 };
    var stg = list[k];
    return {
      coins: nice(stg.firstRewards.coins * ECON.idleCoinsPerHour + 300000),
      exp: 150 + 12 * k,
      scrolls: 10 + Math.floor(k / 5)
    };
  };
  game.idle = function () {
    var s = st(), now = clock();
    var secs = clamp((now - num(s.lastIdle, now)) / 1000, 0, CFG.idleCap);
    var r = game.idleRate();
    return { coins: Math.floor(r.coins * secs / 3600), exp: Math.floor(r.exp * secs / 3600), scrolls: Math.floor(r.scrolls * secs / 3600), seconds: Math.floor(secs), cap: CFG.idleCap };
  };
  game.claimIdle = function () {
    var s = st(), i = game.idle();
    if (i.seconds < 1 || !(i.coins || i.exp || i.scrolls)) return { ok: false, coins: 0, exp: 0, scrolls: 0, seconds: i.seconds, reason: '暂无挂机收益' };
    var g = grant({ coins: i.coins, exp: i.exp, scrolls: i.scrolls });
    s.lastIdle = clock();
    changed('idle', ['coins', 'scrolls', 'player']);
    return { ok: true, coins: i.coins, exp: i.exp, scrolls: i.scrolls, seconds: i.seconds, playerLvUp: g.lvUps };
  };

  /* ---------------- misc settings ---------------- */
  game.setSetting = function (k, v) { st().settings[k] = v; changed('settings', ['settings'], { key: k }); return S.settings; };
  game.setFlag = function (k, v) { st().flags[k] = v; changed('flags', ['flags'], { key: k }); return S.flags; };
  game.setName = function (name) {
    name = String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, 16);
    if (!name) return { ok: false, reason: '名字不能为空' };
    st().player.name = name;
    changed('player', ['player']);
    return { ok: true, name: name };
  };

  /* internals exposed for tools/test-engine.js (not for UI use) */
  game._internal = { getStageAdj: function () { return STAGE_ADJ; }, setStageAdj: function (m) { STAGE_ADJ = m || {}; adjVersion++; }, KIT: KIT, CH_END_POWER: CH_END_POWER, LINEUP: LINEUP, buildLineup: buildLineup, calcStats: calcStats, refTeamPower: refTeamPower, levelSpanCost: levelSpanCost, CHAPTERS: CHAPTERS, CH_END_LV: CH_END_LV, Rng: Rng, buildCampaign: buildCampaign, invalidate: function () { _camp = null; } };

  NG.game = game;
})(typeof window !== 'undefined' ? window : globalThis);
