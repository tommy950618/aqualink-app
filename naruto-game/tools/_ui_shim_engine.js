/* DEV ONLY — tiny stand-in for js/engine.js used by tools/_ui_test.js while the real engine
 * is being written. Implements the CONTRACT §4 surface loosely. Never referenced by index.html. */
(function () {
  'use strict';
  var NG = window.NG;
  function rng(seed) { var a = seed >>> 0; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var R = rng(Date.now() & 0xffff);
  function newState() {
    return { v: 1, created: Date.now(), lastIdle: Date.now() - 3600 * 1000,
      player: { name: '无名忍者', lv: 1, exp: 0 },
      coins: 100000000, gems: 20000, tickets: 1000, scrolls: 200,
      roster: {}, team: [], progress: {}, pity: { ssr: 0, ur: 0 }, totalPulls: 0,
      flags: { welcomed: false }, settings: { speed: 1, auto: true, rotate: 'auto', sound: false } };
  }
  var G = NG.game = {};
  function emit(w) { G.save(); NG.emit('change', { what: w }); }
  G.init = function () {
    if (G.state) return G.state;
    try { G.state = JSON.parse(localStorage.getItem(NG.SAVE_KEY)); } catch (e) { G.state = null; }
    if (!G.state || G.state.v !== 1) G.state = newState();
    return G.state;
  };
  G.save = function () { try { localStorage.setItem(NG.SAVE_KEY, JSON.stringify(G.state)); } catch (e) {} };
  G.reset = function () { G.state = newState(); emit('reset'); return G.state; };
  G.chars = function () { return NG.CHARS; };
  G.char = function (id) { return NG.CHAR_MAP[id] || null; };
  G.owned = function (id) { return G.state.roster[id] || null; };
  G.stats = function (id, e) {
    var c = G.char(id); if (!c) return null;
    e = e || G.owned(id) || { lv: 1, star: 1 };
    var b = NG.RARITY_BASE[c.rarity] || NG.RARITY_BASE.R, r = NG.ROLES[c.role] || NG.ROLES.atk, s = c.stats || {};
    var f = (1 + 0.06 * (e.lv - 1)) * (1 + 0.15 * (e.star - 1));
    var o = { hp: Math.round(b.hp * r.hp * (s.hp || 1) * f), atk: Math.round(b.atk * r.atk * (s.atk || 1) * f), def: Math.round(b.def * r.def * (s.def || 1) * f),
      spd: s.spd || 100, crit: 0.05, critDmg: 1.5, dodge: 0, dr: 0, dmg: 0, lifesteal: 0 };
    o.power = Math.round(o.hp * 0.2 + o.atk * 2 + o.def * 1.5 + o.spd * 3);
    return o;
  };
  G.power = function (id) { var s = G.stats(id); return s ? s.power : 0; };
  G.teamPower = function () { return G.state.team.reduce(function (a, id) { return a + G.power(id); }, 0); };
  G.ownedList = function () {
    return Object.keys(G.state.roster).filter(function (id) { return G.char(id); }).map(function (id) { return { id: id, c: G.char(id), e: G.state.roster[id] }; })
      .sort(function (a, b) { return G.power(b.id) - G.power(a.id); });
  };
  G.maxLevel = function (id) { var e = G.owned(id); return NG.STAR_LEVEL_CAP[e ? e.star : 1]; };
  G.levelCost = function (id, n) { var e = G.owned(id); if (!e) return 0; var to = Math.min(G.maxLevel(id), e.lv + n), c = 0; for (var l = e.lv; l < to; l++) c += 1000 + l * l * 20; return c; };
  G.levelUp = function (id, n) {
    var e = G.owned(id); if (!e) return { ok: false, reason: '未拥有该忍者' };
    var cap = G.maxLevel(id); if (e.lv >= cap) return { ok: false, reason: '已达等级上限，请先升星' };
    var to = Math.min(cap, e.lv + n), cost = G.levelCost(id, to - e.lv);
    if (G.state.coins < cost) return { ok: false, reason: '铜币不足' };
    G.state.coins -= cost; var g = to - e.lv; e.lv = to; emit('level'); return { ok: true, gained: g, cost: cost };
  };
  G.starCost = function (id) { var e = G.owned(id); if (!e || e.star >= NG.MAX_STAR) return null; return NG.STAR_SHARD_COST[e.star]; };
  G.starUp = function (id) { var e = G.owned(id), c = G.starCost(id); if (c == null) return { ok: false, reason: '已满星' }; if (e.shards < c) return { ok: false, reason: '碎片不足' }; e.shards -= c; e.star++; emit('star'); return { ok: true }; };
  G.skillUnlocked = function (id, k) { var e = G.owned(id); if (k !== 'awaken') return true; return !!e && e.star >= NG.AWAKEN_STAR; };
  G.skillCost = function (id, k) { var e = G.owned(id); if (!e) return null; var lv = e.skills[k] || 1; if (lv >= NG.MAX_SKILL_LV) return null; return { coins: 20000 * lv, scrolls: 5 * lv }; };
  G.skillUp = function (id, k) {
    var e = G.owned(id), c = G.skillCost(id, k); if (!c) return { ok: false, reason: '技能已满级' };
    if (!G.skillUnlocked(id, k)) return { ok: false, reason: '技能未解锁' };
    if (G.state.coins < c.coins) return { ok: false, reason: '铜币不足' }; if (G.state.scrolls < c.scrolls) return { ok: false, reason: '忍术卷轴不足' };
    G.state.coins -= c.coins; G.state.scrolls -= c.scrolls; e.skills[k] = (e.skills[k] || 1) + 1; emit('skill'); return { ok: true };
  };
  G.skillValue = function (id, k) { var e = G.owned(id); return 1 + 0.08 * (((e && e.skills[k]) || 1) - 1); };
  G.rates = function () { return { UR: 0.015, SSR: 0.085, SR: 0.30, R: 0.60 }; };
  G.pityInfo = function () { return { ssr: G.state.pity.ssr, ur: G.state.pity.ur, urPity: 90 }; };
  function byR(r) { return NG.CHARS.filter(function (c) { return c.rarity === r; }); }
  G.summon = function (n) {
    if ([1, 10, 100].indexOf(n) < 0) return { ok: false, reason: '参数错误' };
    var st = G.state, need = n, useT = Math.min(st.tickets, need), gem = (need - useT) * 150;
    if (st.gems < gem) return { ok: false, reason: '招募券不足' };
    st.tickets -= useT; st.gems -= gem;
    var res = [];
    for (var i = 0; i < n; i++) {
      var x = R(), r = x < 0.015 ? 'UR' : x < 0.1 ? 'SSR' : x < 0.4 ? 'SR' : 'R';
      st.pity.ur++; if (st.pity.ur >= 90) r = 'UR';
      if (n >= 10 && i % 10 === 9 && !res.slice(-9).some(function (q) { return q.rarity === 'UR' || q.rarity === 'SSR'; })) r = 'SSR';
      if (r === 'UR') st.pity.ur = 0;
      var pool = byR(r); if (!pool.length) pool = NG.CHARS;
      var c = pool[Math.floor(R() * pool.length)], e = st.roster[c.id], isNew = !e, sh = 0;
      if (isNew) st.roster[c.id] = { lv: 1, star: 1, shards: 0, skills: { passive: 1, s1: 1, s2: 1, ult: 1, awaken: 1 }, obtained: Date.now() };
      else { sh = (NG.RARITIES[c.rarity] || {}).dupShards || 20; e.shards += sh; }
      res.push({ id: c.id, rarity: c.rarity, isNew: isNew, shards: sh });
    }
    st.totalPulls += n; if (st.team.length < 5) G.autoTeam(true);
    emit('summon'); return { ok: true, results: res };
  };
  G.setTeam = function (ids) { G.state.team = (ids || []).filter(function (id) { return G.owned(id); }).slice(0, 5); emit('team'); };
  G.autoTeam = function (silent) { G.state.team = G.ownedList().slice(0, 5).map(function (x) { return x.id; }); if (!silent) emit('team'); return G.state.team; };
  var CH = ['波之国', '中忍考试', '木叶崩溃', '寻找纲手', '佐助奪还', '风影奪还', '天地桥', '飞段与角都', '宇智波兄弟', '佩恩袭击', '五影会谈', '第四次忍界大战·上', '第四次忍界大战·下', '大筒木辉夜'];
  var BG = ['forest', 'forest', 'village', 'village', 'valley', 'desert', 'forest', 'forest', 'rain', 'village', 'mist', 'battlefield', 'battlefield', 'moon'];
  var chapters = null;
  G.chapters = function () {
    if (chapters) return chapters;
    var ids = NG.CHARS.map(function (c) { return c.id; }), r2 = rng(42);
    chapters = CH.map(function (n, ci) {
      var stages = [];
      for (var si = 0; si < 8; si++) {
        var boss = si === 7, cnt = boss ? 3 : 2 + Math.floor(r2() * 4), en = [];
        for (var k = 0; k < cnt; k++) en.push({ id: ids[Math.floor(r2() * ids.length)], lv: 1 + ci * 22 + si * 3, star: 1 + Math.floor(ci / 3), boss: boss && k === 0 });
        stages.push({ id: (ci + 1) + '-' + (si + 1), name: n + ' ' + (si + 1), enemies: en, power: 2000 * Math.pow(1.6, ci + si / 8),
          rewards: { coins: 5000 * (ci + 1), scrolls: 2 + ci, exp: 50 }, firstRewards: { gems: 100, tickets: si === 7 ? 10 : 0 } });
      }
      return { id: 'ch' + (ci + 1), name: n, desc: '第' + (ci + 1) + '章 · ' + n + '的故事。', bg: BG[ci], stages: stages };
    });
    return chapters;
  };
  G.stage = function (sid) { var r = null; G.chapters().forEach(function (c) { c.stages.forEach(function (s) { if (s.id === sid) r = s; }); }); return r; };
  G.stageState = function (sid) {
    var all = []; G.chapters().forEach(function (c) { c.stages.forEach(function (s) { all.push(s.id); }); });
    var i = all.indexOf(sid); return { unlocked: i === 0 || (i > 0 && (G.state.progress[all[i - 1]] || 0) > 0), stars: G.state.progress[sid] || 0 };
  };
  G.battleStage = function (sid, seed) {
    var st = G.stage(sid); if (!st) return null;
    var A = G.state.team.map(function (id) { var e = G.owned(id); return { id: id, lv: e.lv, star: e.star, skills: e.skills }; });
    var B = st.enemies.filter(function (e) { return G.char(e.id); }).map(function (e) { return { id: e.id, lv: e.lv, star: e.star, boss: e.boss, hpMult: e.boss ? 2.5 : 1 }; });
    return NG.battle.simulate(A, B, { seed: seed || Math.floor(R() * 1e9) });
  };
  G.finishStage = function (sid, rec) {
    var st = G.stage(sid), win = rec && rec.winner === 'A', first = win && !G.state.progress[sid];
    var rw = {};
    if (win) {
      G.state.progress[sid] = Math.max(G.state.progress[sid] || 0, rec.stars);
      var add = function (o) { Object.keys(o || {}).forEach(function (k) { if (!o[k]) return; rw[k] = (rw[k] || 0) + o[k]; if (k !== 'exp') G.state[k] = (G.state[k] || 0) + o[k]; }); };
      add(st.rewards); if (first) add(st.firstRewards);
      G.state.player.exp += rw.exp || 0; while (G.state.player.exp >= 100 * G.state.player.lv) { G.state.player.exp -= 100 * G.state.player.lv; G.state.player.lv++; }
      emit('stage');
    }
    return { win: win, stars: win ? rec.stars : 0, rewards: rw, firstClear: first };
  };
  G.idle = function () { var s = Math.min(43200, (Date.now() - G.state.lastIdle) / 1000); return { coins: Math.floor(s * 30), exp: Math.floor(s / 60), scrolls: Math.floor(s / 600), seconds: Math.floor(s) }; };
  G.claimIdle = function () { var i = G.idle(); G.state.coins += i.coins; G.state.scrolls += i.scrolls; G.state.lastIdle = Date.now(); emit('idle'); return i; };

  /* ---------------- battle ---------------- */
  NG.battle = {
    simulate: function (ta, tb, opt) {
      var rand = rng((opt && opt.seed) || 1), ev = [], units = [];
      function mk(t, side) { return t.map(function (u, i) { var c = G.char(u.id), s = G.stats(u.id, { lv: u.lv, star: u.star }); return { uid: side + i, side: side, pos: i, id: u.id, name: c.name, form: c.form, rarity: c.rarity, lv: u.lv, star: u.star, maxHp: Math.round(s.hp * (u.hpMult || 1)), hp: Math.round(s.hp * (u.hpMult || 1)), chakra: 0, boss: !!u.boss, atk: s.atk, def: s.def, spd: s.spd, g: 0, shield: 0, c: c, cd: 0, st: {} }; }); }
      var A = mk(ta, 'A'), B = mk(tb, 'B'); units = A.concat(B);
      var snap = units.map(function (u) { return { uid: u.uid, side: u.side, pos: u.pos, id: u.id, name: u.name, form: u.form, rarity: u.rarity, lv: u.lv, star: u.star, maxHp: u.maxHp, hp: u.hp, chakra: 0, boss: u.boss }; });
      function alive(s) { return units.filter(function (u) { return u.side === s && u.hp > 0; }); }
      units.forEach(function (u) { if (rand() < 0.4) { u.chakra = 20; ev.push({ t: 'passive', uid: u.uid, name: (u.c.skills && u.c.skills.passive && u.c.skills.passive.name) || '被动' }); ev.push({ t: 'chakra', uid: u.uid, chakra: 20 }); } });
      var round = 0, acts = 0;
      while (round < 30 && alive('A').length && alive('B').length) {
        round++; ev.push({ t: 'round', n: round });
        var order = units.filter(function (u) { return u.hp > 0; }).sort(function (a, b) { return b.spd - a.spd; });
        for (var oi = 0; oi < order.length; oi++) {
          var u = order[oi]; if (u.hp <= 0) continue;
          var foes = alive(u.side === 'A' ? 'B' : 'A'), friends = alive(u.side); if (!foes.length) break;
          if (u.st.burn) { var d0 = Math.round(u.maxHp * 0.04); u.hp = Math.max(0, u.hp - d0); ev.push({ t: 'dmg', src: u.uid, uid: u.uid, amount: d0, crit: false, kind: 'dot', hp: u.hp, shield: u.shield }); if (--u.st.burn <= 0) { delete u.st.burn; ev.push({ t: 'status_end', uid: u.uid, status: 'burn' }); } if (u.hp <= 0) { ev.push({ t: 'death', uid: u.uid }); continue; } }
          if (u.st.stun) { ev.push({ t: 'skip', uid: u.uid, status: 'stun' }); delete u.st.stun; ev.push({ t: 'status_end', uid: u.uid, status: 'stun' }); continue; }
          var key = u.chakra >= 100 ? 'ult' : (u.cd <= 0 ? 's2' : 's1'), sk = (u.c.skills && u.c.skills[key]) || { name: '攻击', fx: 'fist', target: 'single' };
          if (key === 's2') u.cd = 3; else u.cd--;
          var tg = sk.target === 'all' ? foes : sk.target && sk.target.indexOf('ally') === 0 ? (sk.target === 'ally_all' ? friends : [friends[0]]) : sk.target === 'self' ? [u] : [foes[Math.floor(rand() * foes.length)]];
          ev.push({ t: 'act', uid: u.uid, skill: key, name: sk.name, fx: sk.fx || 'fist', targets: tg.map(function (x) { return x.uid; }) });
          if (key === 'ult') { u.chakra = 0; ev.push({ t: 'chakra', uid: u.uid, chakra: 0 }); }
          var isHeal = (sk.effects || []).some(function (e) { return e.type === 'heal'; }) && tg[0] && tg[0].side === u.side;
          tg.forEach(function (t) {
            if (t.side === u.side) {
              if (isHeal) { var h = Math.round(u.atk * 1.2); t.hp = Math.min(t.maxHp, t.hp + h); ev.push({ t: 'heal', src: u.uid, uid: t.uid, amount: h, hp: t.hp }); }
              else { t.shield += Math.round(u.atk * 0.8); ev.push({ t: 'shield', uid: t.uid, amount: Math.round(u.atk * 0.8), shield: t.shield }); ev.push({ t: 'status', uid: t.uid, status: 'buff:atk', turns: 2 }); }
              return;
            }
            if (rand() < 0.08) { ev.push({ t: 'miss', src: u.uid, uid: t.uid }); return; }
            var hits = key === 'ult' ? 3 : 1;
            for (var h2 = 0; h2 < hits && t.hp > 0; h2++) {
              var crit = rand() < 0.15, m = key === 'ult' ? 1.0 : key === 's2' ? 1.7 : 1.0, dmg = Math.round(u.atk * m * (crit ? 1.5 : 1) * 1000 / (1000 + t.def * 2) * (0.9 + rand() * 0.2));
              var ab = Math.min(t.shield, dmg); t.shield -= ab; t.hp = Math.max(0, t.hp - (dmg - ab));
              ev.push({ t: 'dmg', src: u.uid, uid: t.uid, amount: dmg, crit: crit, kind: 'hit', adv: rand() < 0.2, hp: t.hp, shield: t.shield });
            }
            if (t.hp > 0) { t.chakra = Math.min(100, t.chakra + 10); ev.push({ t: 'chakra', uid: t.uid, chakra: t.chakra }); }
            if (t.hp > 0 && key !== 's1' && rand() < 0.3) { var s = ['stun', 'burn', 'debuff:def', 'silence'][Math.floor(rand() * 4)]; if (s === 'stun') t.st.stun = 1; if (s === 'burn') t.st.burn = 2; ev.push({ t: 'status', uid: t.uid, status: s, turns: 2 }); }
            if (t.hp <= 0) { ev.push({ t: 'death', uid: t.uid }); if (t.side === 'A' && !t.rev && rand() < 0.3) { t.rev = 1; t.hp = Math.round(t.maxHp * 0.3); ev.push({ t: 'passive', uid: t.uid, name: '秽土转生' }); ev.push({ t: 'revive', uid: t.uid, hp: t.hp }); } }
          });
          if (key !== 'ult') { u.chakra = Math.min(100, u.chakra + 25 + (rand() < 0.3 ? 30 : 0)); ev.push({ t: 'chakra', uid: u.uid, chakra: u.chakra }); }
          if (++acts > 400) break;
        }
      }
      var win = alive('A').length && !alive('B').length ? 'A' : 'B', deaths = A.filter(function (u) { return u.hp <= 0; }).length;
      ev.push({ t: 'end', winner: win });
      return { winner: win, rounds: round, stars: win === 'A' ? (deaths === 0 ? 3 : deaths <= 2 ? 2 : 1) : 0, seed: opt && opt.seed, units: snap, events: ev };
    }
  };
})();
