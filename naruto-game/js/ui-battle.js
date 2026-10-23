/* 忍界传说 · ui-battle.js — 战斗: replays NG.game.battleStage() record.events with lunges, projectiles,
 * beams, slashes, AoE, floating numbers, HP/shield/chakra bars, statuses, death/revive, ult cut-ins,
 * speed ×1/×2/×4, skip, and the result modal (NG.game.finishStage). */
(function () {
  'use strict';
  var NG = window.NG, U = NG.ui;
  var B = { token: 0 };
  var SLOTS = [[538, 470], [388, 340], [388, 610], [226, 458], [226, 664], [538, 262]];
  var ST_LABEL = { stun: '晕', freeze: '冰', sleep: '睡', bind: '缚', silence: '封', burn: '灼', poison: '毒', bleed: '血', taunt: '嘲', counter: '反', immune: '免' };
  var STAT_CN = { atk: '攻', def: '防', spd: '速', crit: '暴', critDmg: '爆', dmg: '伤', dr: '免', dodge: '闪' };
  var STAT_FULL = { atk: '攻击', def: '防御', spd: '速度', crit: '暴击', critDmg: '暴伤', dmg: '伤害', dr: '减伤', dodge: '闪避' };

  function speed() { return B.speed || U.settings().speed || 1; }
  function wait(ms) {
    var tk = B.token;
    return new Promise(function (res) {
      if (B.skip || tk !== B.token) return res();
      var w = function () { clearTimeout(t); res(); };
      var t = setTimeout(function () { var i = B.wakers.indexOf(w); if (i >= 0) B.wakers.splice(i, 1); res(); }, ms / speed());
      B.wakers.push(w);
    });
  }
  function alive(tk) { return tk === B.token && !B.skip; }
  function anim(el, kf, dur, opt) {
    if (!el || !el.animate || B.skip) return Promise.resolve();
    opt = opt || {};
    try {
      var a = el.animate(kf, { duration: Math.max(16, dur / speed()), easing: opt.easing || 'ease-out', fill: opt.fill || 'none', delay: (opt.delay || 0) / speed() });
      B.anims.push(a);
      var drop = function () { var i = B.anims.indexOf(a); if (i >= 0 && opt.fill !== 'forwards') B.anims.splice(i, 1); };
      return a.finished.then(drop, drop);
    } catch (e) { return Promise.resolve(); }
  }
  function fxColors(fx) { var f = (NG.FX && NG.FX[fx]) || null; return f || { c1: '#ffcc80', c2: '#ffffff', fam: 'slash', k: '忍', n: '' }; }
  function layer() { return U.$('.bt-fx', B.el); }
  function fxEl(cls, x, y, f, extra) {
    var d = document.createElement('div');
    d.className = 'fxe ' + cls;
    d.style.cssText = 'left:' + x + 'px;top:' + y + 'px;--c1:' + f.c1 + ';--c2:' + f.c2 + ';' + (extra || '');
    layer().appendChild(d);
    return d;
  }
  function kill(el, ms) { setTimeout(function () { if (el && el.parentNode) el.parentNode.removeChild(el); }, ms == null ? 0 : ms); }
  function center(u) { return { x: u.x, y: u.y - (u.boss ? 112 : 92) }; }

  /* ---------------- screen ---------------- */
  U.screen('battle', {
    title: '战斗', noTopbar: true, particles: null,
    bg: function (p) { var st = U.call('stage', p.stage) || {}, ch = U.chapterOf && U.chapterOf(p.stage); return st.bg || (ch && ch.bg) || 'battlefield'; },
    build: function (el) {
      el.innerHTML = '<div class="bt-world"><div class="bt-ground"></div><div class="bt-units"></div><div class="bt-fx"></div></div>' +
        '<div class="bt-top"><div class="bt-round">第 <b>1</b> / 30 回合</div><div class="bt-stage"></div></div><div class="bt-boss hidden"><div class="bn"><span class="bt">BOSS</span><span class="n"></span><span class="pc"></span></div><div class="bb"><i class="lag"></i><i class="v"></i></div></div>' +
        '<div class="bt-auto"><button class="btn dark sm" data-a="exit">撤退</button><span class="lamp">自动战斗</span></div>' +
        '<div class="bt-ctrl"><button class="btn blue sm" data-a="speed">×1</button><button class="btn sm" data-a="skip">跳过</button></div>' +
        '<div class="bt-pw a"><img src="' + U.iconURL('power') + '" alt=""><span></span></div><div class="bt-pw b"><img src="' + U.iconURL('power') + '" alt=""><span></span></div>';
      B.el = el;
      U.$('[data-a="speed"]', el).addEventListener('click', function () {
        var s = speed(), n = s >= 4 ? 1 : s >= 2 ? 4 : 2;
        B.speed = n; U.setSetting('speed', n); syncSpeed();
      });
      U.$('[data-a="skip"]', el).addEventListener('click', function () { if (!B.rec || B.finished) return; skipAll(); });
      U.$('[data-a="exit"]', el).addEventListener('click', function () {
        if (B.finished) return;
        U.confirm({ title: '撤退', text: '确定要撤退吗？', sub: '本次战斗不会获得任何奖励', ok: '撤退', okCls: 'red' }, function () { abort(); U.go('campaign', { stage: B.stage }, { replace: true }); });
      });
    },
    show: function (el, p) { start(p.stage); },
    leave: function () { abort(); },
    onBack: function () { if (B.finished || !B.rec) { abort(); return true; } U.$('[data-a="exit"]', B.el).click(); return false; }
  });
  function syncSpeed() { var b = U.$('[data-a="speed"]', B.el); if (b) b.textContent = '×' + speed(); }
  function abort() {
    B.token++; B.skip = false;
    (B.wakers || []).forEach(function (f) { f(); }); B.wakers = [];
    (B.anims || []).forEach(function (a) { try { a.cancel(); } catch (e) {} }); B.anims = [];
    var fx = U.$('.cutin', U.$('#fx')); if (fx) fx.remove();
  }

  function start(sid) {
    abort();
    B.stage = sid; B.finished = false; B.skip = false; B.wakers = []; B.anims = []; B.speed = U.settings().speed || 1;
    syncSpeed();
    var el = B.el;
    U.$('.bt-units', el).innerHTML = ''; U.$('.bt-fx', el).innerHTML = '';
    var rec = U.call('battleStage', sid);
    if (!rec || !Array.isArray(rec.units) || !Array.isArray(rec.events)) {
      U.toast('无法开始战斗（请检查编队）', 'err');
      setTimeout(function () { U.go('campaign', { stage: sid }, { replace: true }); }, 50);
      return;
    }
    B.rec = rec; B.units = {}; B.idx = 0;
    B.maxR = rec.maxRounds || (NG.game && NG.game.cfg && NG.game.cfg.maxRounds) || 30;
    var st = U.call('stage', sid) || {}, ch = U.chapterOf && U.chapterOf(sid);
    U.$('.bt-stage', el).textContent = (ch ? ch.name + ' · ' : '') + (st.name || sid);
    U.$('.bt-round', el).innerHTML = '第 <b>1</b> / ' + B.maxR + ' 回合';
    var pa = 0, pb = 0;
    rec.units.forEach(function (u0) {
      var c = U.char(u0.id) || { id: u0.id, name: u0.name || '???', rarity: u0.rarity || 'R' };
      var side = u0.side === 'B' ? 'B' : 'A';
      var pos = u0.pos | 0, sl = SLOTS[pos] || [120 + (pos - 6) * 80, 200];
      var x = side === 'A' ? sl[0] : 1280 - sl[0], y = sl[1];
      var u = { uid: u0.uid, side: side, pos: pos, id: u0.id, c: c, x: x, y: y, maxHp: u0.maxHp || 1, hp: u0.hp != null ? u0.hp : u0.maxHp, shield: u0.shield || 0, chakra: u0.chakra || 0, boss: !!u0.boss, dead: (u0.hp != null && u0.hp <= 0), st: {} };
      if (side === 'A') pa += U.call('power', u0.id) || 0;
      var ue = U.h('<div class="bt-unit ' + side + (u.boss ? ' boss' : '') + '" style="left:' + x + 'px;top:' + y + 'px;z-index:' + (5 + Math.round(y / 10)) + '"><div class="mv">' +
        '<div class="ring"></div><div class="body"><div class="sh"></div><img src="' + U.bustURL(c) + '" alt=""></div>' + (u.boss ? '<span class="bossb">BOSS</span>' : '') +
        '<div class="bt-st"></div><div class="hud"><div class="nmr">' + U.rarHTML(U.rarity(c)) + '<span class="lv">Lv.' + (u0.lv || 1) + '</span><span class="n">' + U.esc(u0.name || U.charName(c)) + '</span></div>' +
        '<div class="bt-hp"><i class="lag"></i><i class="v"></i><i class="sd"></i></div><div class="bt-ck"><i class="v"></i></div></div></div></div>');
      u.el = ue; u.mv = U.$('.mv', ue);
      U.$('.bt-units', el).appendChild(ue);
      B.units[u.uid] = u;
      setHP(u, u.hp, u.shield, true); setCk(u, u.chakra);
      if (u.dead) ue.classList.add('dead');
    });
    B.boss = null;
    Object.keys(B.units).forEach(function (k) { var u = B.units[k]; if (u.side === 'B' && u.boss && !B.boss) B.boss = u; });
    var bb = U.$('.bt-boss', el); bb.classList.toggle('hidden', !B.boss);
    if (B.boss) { U.$('.n', bb).textContent = U.charName(B.boss.c) + (B.boss.c.form ? '·' + B.boss.c.form : ''); bossBar(true); }
    pb = st.power || 0;
    U.$('.bt-pw.a span', el).textContent = '我方战力 ' + U.fmt(pa || U.call('teamPower') || 0);
    U.$('.bt-pw.b span', el).textContent = '推荐战力 ' + U.fmt(pb);
    run(B.token);
  }

  /* ---------------- HUD ---------------- */
  function setHP(u, hp, shield, instant) {
    if (hp != null && !isNaN(hp)) u.hp = Math.max(0, hp);
    if (shield != null && !isNaN(shield)) u.shield = Math.max(0, shield);
    var p = U.clamp(u.hp / u.maxHp, 0, 1) * 100, s = U.clamp(u.shield / u.maxHp, 0, 1) * 100;
    var bar = U.$('.bt-hp', u.el);
    if (instant) U.$$('i', bar).forEach(function (i) { i.style.transition = 'none'; });
    U.$('.v', bar).style.transform = 'scaleX(' + p / 100 + ')'; U.$('.lag', bar).style.transform = 'scaleX(' + p / 100 + ')'; U.$('.sd', bar).style.transform = 'scaleX(' + s / 100 + ')';
    if (instant) { void bar.offsetWidth; U.$$('i', bar).forEach(function (i) { i.style.transition = ''; }); }
    if (u === B.boss) bossBar(instant);
  }
  function bossBar(instant) {
    var u = B.boss, bb = U.$('.bt-boss', B.el); if (!u || !bb) return;
    var p = U.clamp(u.hp / u.maxHp, 0, 1) * 100;
    if (instant) U.$$('.bb i', bb).forEach(function (i) { i.style.transition = 'none'; });
    U.$('.bb .v', bb).style.transform = 'scaleX(' + p / 100 + ')'; U.$('.bb .lag', bb).style.transform = 'scaleX(' + p / 100 + ')';
    U.$('.pc', bb).textContent = Math.ceil(p) + '%';
    if (instant) { void bb.offsetWidth; U.$$('.bb i', bb).forEach(function (i) { i.style.transition = ''; }); }
  }
  function setCk(u, v) {
    if (v == null || isNaN(v)) return; u.chakra = v;
    var ck = U.$('.bt-ck', u.el); U.$('.v', ck).style.transform = 'scaleX(' + U.clamp(v, 0, 100) / 100 + ')'; ck.classList.toggle('full', v >= 100);
  }
  function statusInfo(s) {
    s = String(s || '');
    if (s.indexOf('buff:') === 0) { var k = s.slice(5); return { l: (STAT_CN[k] || '增') + '↑', c: '#2fa84f', t: (STAT_FULL[k] || '属性') + '提升', good: true }; }
    if (s.indexOf('debuff:') === 0) { var k2 = s.slice(7); return { l: (STAT_CN[k2] || '减') + '↓', c: '#c0392b', t: (STAT_FULL[k2] || '属性') + '降低' }; }
    var d = NG.STATUSES && NG.STATUSES[s];
    if (d) return { l: ST_LABEL[s] || d.name.charAt(0), c: d.color, t: d.name };
    if (s === 'taunt') return { l: '嘲', c: '#7f8c9a', t: '嘲讽', good: true };
    if (s === 'counter') return { l: '反', c: '#e8590c', t: '反击', good: true };
    if (s === 'immune') return { l: '免', c: '#e0a31a', t: '免疫控制', good: true };
    if (s === 'shield') return null;
    return { l: s.charAt(0) || '?', c: '#5c6fa8', t: s };
  }
  function addStatus(u, s) {
    var info = statusInfo(s); if (!info) return null;
    var box = U.$('.bt-st', u.el);
    if (!u.st[s]) {
      var i = document.createElement('i'); i.textContent = info.l; i.style.setProperty('--c', info.c); i.setAttribute('data-s', s);
      box.appendChild(i); u.st[s] = i;
      while (box.children.length > 6) { var f = box.firstChild; delete u.st[f.getAttribute('data-s')]; box.removeChild(f); }
    }
    return info;
  }
  function rmStatus(u, s) { var i = u.st[s]; if (i && i.parentNode) i.parentNode.removeChild(i); delete u.st[s]; }
  var stackY = {};
  function float(u, html, cls, style) {
    if (B.skip) return;
    var txt = cls && /txt|miss/.test(cls);
    var c = center(u), k = u.uid + (txt ? 't' : 'd'), now = performance.now();
    var sy = stackY[k] && now - stackY[k].t < 450 / speed() ? (stackY[k].n + 1) % 4 : 0; stackY[k] = { n: sy, t: now };
    var d = document.createElement('div');
    d.className = 'dmg ' + (cls || '');
    d.style.cssText = 'left:' + (c.x + (txt ? 0 : Math.random() * 36 - 18)) + 'px;top:' + (txt ? c.y + 34 - sy * 26 : c.y - 44 - sy * 34) + 'px;animation-duration:' + (cls && cls.indexOf('txt') >= 0 ? 1200 : 900) / Math.sqrt(speed()) + 'ms;' + (style || '');
    d.innerHTML = html;
    layer().appendChild(d);
    kill(d, 1300 / Math.sqrt(speed()));
  }
  function num(n) { n = Math.round(Number(n) || 0); return n >= 100000 ? U.fmt(n) : String(n); }
  function hitReact(u, crit) {
    if (B.skip) return;
    var kb = u.side === 'A' ? -12 : 12, body = u.body || (u.body = U.$('.body', u.el)), img = u.img || (u.img = U.$('.body img', u.el));
    anim(body, [{ transform: 'none' }, { transform: 'translateX(' + kb + 'px) rotate(' + (kb / 4) + 'deg)', offset: .3 }, { transform: 'none' }], 220);
    anim(img, [{ filter: 'drop-shadow(0 0 1.5px rgba(0,0,0,.8)) brightness(2.2) saturate(.3)' }, { filter: 'drop-shadow(0 0 1.5px rgba(0,0,0,.8))' }], 200);
    if (crit) shake(1);
  }
  function shake(big) {
    if (B.skip) return; var w = B.world || (B.world = U.$('.bt-world', B.el)), m = big > 1 ? 14 : 8;
    anim(w, [{ transform: 'none' }, { transform: 'translate(' + -m + 'px,' + m / 2 + 'px)' }, { transform: 'translate(' + m * .8 + 'px,' + -m * .6 + 'px)' }, { transform: 'translate(' + -m * .6 + 'px,' + -m * .4 + 'px)' }, { transform: 'translate(' + m * .4 + 'px,' + m * .3 + 'px)' }, { transform: 'none' }], big > 1 ? 480 : 320, { easing: 'linear' });
  }

  /* ---------------- event application ---------------- */
  function apply(e) {
    var u = B.units[e.uid];
    switch (e.t) {
      case 'round':
        U.$('.bt-round', B.el).innerHTML = '第 <b>' + e.n + '</b> / ' + B.maxR + ' 回合' + (e.rage ? '<span class="rage">狂暴 伤害+' + Math.round(e.rage * 100) + '%</span>' : ''); break;
      case 'dmg':
        if (!u) break;
        setHP(u, e.hp, e.shield);
        var cls = e.crit ? 'crit' : e.kind === 'dot' ? 'dot' : e.kind === 'true' ? 'true' : '';
        float(u, (e.kind === 'dot' ? '' : '-') + num(e.amount) + (e.adv ? '<span class="adv">克制</span>' : ''), cls);
        if (e.kind !== 'dot') hitReact(u, e.crit);
        if (e.kind === 'counter') float(u, '反击', 'txt', '--c:#ff9a5c');
        if (e.kind === 'execute') float(u, '斩杀', 'txt', '--c:#d68bff');
        break;
      case 'miss': if (u) float(u, '闪避', 'miss'); break;
      case 'heal': if (u) { setHP(u, e.hp, null); float(u, '+' + num(e.amount), 'heal'); } break;
      case 'shield': if (u) { setHP(u, null, e.shield); if (e.amount > 0) float(u, '护盾+' + num(e.amount), 'shieldn'); } break;
      case 'status':
        if (!u) break;
        if (e.status === 'shield') break;
        var info = addStatus(u, e.status);
        if (info) float(u, info.t, 'txt', '--c:' + (info.good ? '#9dffb0' : '#ffb38a'));
        break;
      case 'status_end': if (u) rmStatus(u, e.status); break;
      case 'chakra': if (u) setCk(u, e.chakra); break;
      case 'skip':
        if (!u) break;
        var si = statusInfo(e.status); float(u, (si ? si.t : '无法行动') + '中', 'txt', '--c:#ffe08a');
        break;
      case 'passive': if (u) float(u, '【' + U.esc(e.name || '被动') + '】', 'txt', '--c:#ffe9a6'); break;
      case 'death':
        if (!u) break; u.dead = true; setHP(u, 0, 0);
        Object.keys(u.st).forEach(function (s) { rmStatus(u, s); });
        u.el.classList.add('dead'); break;
      case 'revive':
        if (!u) break; u.dead = false; u.el.classList.remove('dead'); if (e.maxHp) u.maxHp = e.maxHp; setHP(u, e.hp, 0); setCk(u, e.chakra || 0);
        u.el.classList.remove('revive'); void u.el.offsetWidth; u.el.classList.add('revive');
        float(u, '复活！', 'txt', '--c:#ffe08a');
        if (!B.skip) { var c = center(u), p = fxEl('fx-pillar', c.x, c.y + 80, { c1: '#ffd25a', c2: '#fff' }); anim(p, [{ opacity: 0, transform: 'scaleY(.2)' }, { opacity: 1, transform: 'scaleY(1.1)', offset: .4 }, { opacity: 0, transform: 'scaleY(1.3)' }], 900).then(function () { kill(p); }); }
        break;
    }
  }

  /* ---------------- playback loop ---------------- */
  function isGroupStop(e) { return e.t === 'act' || e.t === 'round' || e.t === 'end' || e.t === 'skip' || (e.t === 'dmg' && e.kind === 'dot'); }
  async function run(tk) {
    var ev = B.rec.events;
    await intro(tk);
    while (B.idx < ev.length) {
      if (tk !== B.token) return;
      if (B.skip) break;
      var e = ev[B.idx++];
      if (!e) continue;
      if (e.t === 'end') break;
      if (e.t === 'act') {
        var group = [];
        while (B.idx < ev.length && !isGroupStop(ev[B.idx])) group.push(ev[B.idx++]);
        try { await playAct(e, group, tk); } catch (x) { U.warn('playAct', x); group.forEach(apply); }
      } else {
        apply(e);
        if (e.t === 'round') await wait(140);
        else if (e.t === 'dmg' || e.t === 'skip') await wait(380);
        else if (e.t === 'passive' || e.t === 'death' || e.t === 'revive') await wait(300);
        else if (e.t === 'status') await wait(120);
      }
    }
    if (tk !== B.token) return;
    if (B.skip) { while (B.idx < ev.length) apply(ev[B.idx++]); }
    finish(tk);
  }
  function skipAll() {
    B.skip = true;
    (B.wakers || []).forEach(function (f) { f(); }); B.wakers = [];
    (B.anims || []).forEach(function (a) { try { a.cancel(); } catch (e) {} }); B.anims = [];
    Object.keys(B.units || {}).forEach(function (k) { var u = B.units[k]; try { u.mv.getAnimations().forEach(function (x) { x.cancel(); }); } catch (e) {} u.el.classList.remove('acting', 'hit'); });
    var ci = U.$('#fx .cutin'); if (ci) ci.remove();
    U.$$('.dmg,.fxe', B.el).forEach(function (d) { d.remove(); });
  }
  async function intro(tk) {
    var us = Object.keys(B.units).map(function (k) { return B.units[k]; });
    us.forEach(function (u, i) {
      anim(u.mv, [{ opacity: 0, transform: 'translateX(' + (u.side === 'A' ? -260 : 260) + 'px)' }, { opacity: 1, transform: 'none' }], 520, { delay: u.pos * 60, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    });
    await wait(450);
    if (!alive(tk)) return;
    var vs = U.h('<div class="bt-vs gold-text">战斗开始</div>');
    B.el.appendChild(vs); kill(vs, 1300);
    await wait(900);
  }

  async function playAct(act, group, tk) {
    var a = B.units[act.uid];
    if (!a || a.dead && act.skill !== 'passive') { group.forEach(apply); return; }
    var fx = fxColors(act.fx), fam = fx.fam || 'slash', isUlt = act.skill === 'ult';
    var targets = (act.targets || []).map(function (id) { return B.units[id]; }).filter(Boolean);
    var foes = targets.filter(function (t) { return t.side !== a.side; }), friends = targets.filter(function (t) { return t.side === a.side; });
    a.el.classList.add('acting');
    // pre events (e.g. chakra reset) until the first impact event
    var impactTypes = { dmg: 1, miss: 1, heal: 1, shield: 1, status: 1, death: 1, revive: 1 };
    var k = 0; while (k < group.length && !impactTypes[group[k].t]) apply(group[k++]);
    var rest = group.slice(k);
    if (isUlt && alive(tk)) await cutIn(a, act, fx, tk);
    else if (act.skill === 's2' && alive(tk)) skillLabel(a, act.name, fx);
    if (!alive(tk)) { rest.forEach(apply); a.el.classList.remove('acting'); return; }
    var lungeBack = null;
    if (foes.length) lungeBack = await travel(a, foes, fam, fx, isUlt, tk);
    else if (friends.length || !targets.length) await selfCast(a, friends.length ? friends : [a], fam, fx, tk);
    // impact
    var lastT = null;
    for (var i = 0; i < rest.length; i++) {
      var e = rest[i];
      if (!alive(tk)) { apply(e); continue; }
      if (e.t === 'dmg' || e.t === 'miss') {
        var tu = B.units[e.uid];
        if (lastT === e.uid) await wait(isUlt ? 120 : 140); else if (lastT) await wait(45);
        if (tu && e.src === act.uid) impactFx(tu, fam, fx, isUlt);
        lastT = e.uid;
      } else if (e.t === 'death') { await wait(120); }
      apply(e);
    }
    await wait(isUlt ? 420 : 300);
    if (lungeBack) await lungeBack();
    a.el.classList.remove('acting');
    await wait(120);
  }

  function skillLabel(a, name, fx) {
    if (B.skip || !name) return;
    var c = center(a);
    var d = document.createElement('div'); d.className = 'fx-skill'; d.style.cssText = 'left:' + c.x + 'px;top:' + (c.y - 128) + 'px;--c1:' + fx.c1;
    d.textContent = name; layer().appendChild(d);
    anim(d, [{ opacity: 0, transform: 'translate(-50%,10px) scale(.8)' }, { opacity: 1, transform: 'translate(-50%,0) scale(1)', offset: .15 }, { opacity: 1, offset: .8 }, { opacity: 0, transform: 'translate(-50%,-14px)' }], 1100).then(function () { kill(d); });
  }

  /* move toward targets (melee) or launch projectiles; resolves at impact, returns a "go back" fn */
  async function travel(a, foes, fam, fx, isUlt, tk) {
    var ac = center(a), tc = avg(foes.map(center));
    var dir = a.side === 'A' ? 1 : -1;
    if (fam === 'slash' || (fam === 'burst' && foes.length === 1 && Math.random() < 0.5)) {
      var tx = (foes.length > 1 ? tc.x : center(foes[0]).x) - dir * 120 - a.x, ty = (foes.length > 1 ? tc.y : center(foes[0]).y) - ac.y;
      await anim(a.mv, [{ transform: 'none' }, { transform: 'translate(' + tx + 'px,' + ty + 'px) scale(1.06)' }], isUlt ? 200 : 230, { fill: 'forwards', easing: 'cubic-bezier(.5,0,.9,.4)' });
      return function () { return anim(a.mv, [{ transform: 'translate(' + tx + 'px,' + ty + 'px)' }, { transform: 'none' }], 260, { fill: 'forwards', easing: 'cubic-bezier(.2,.8,.3,1)' }).then(function () { try { a.mv.getAnimations().forEach(function (x) { x.cancel(); }); } catch (e) {} }); };
    }
    // ranged: windup hop
    anim(a.mv, [{ transform: 'none' }, { transform: 'translate(' + (-dir * 14) + 'px,-10px)' }, { transform: 'none' }], 260);
    var charge = fxEl('fx-burst', ac.x + dir * 40, ac.y, fx, 'width:90px;height:90px;margin:-45px 0 0 -45px');
    anim(charge, [{ opacity: 0, transform: 'scale(.2)' }, { opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.4)' }], 320).then(function () { kill(charge); });
    await wait(150);
    if (fam === 'beam') {
      foes.forEach(function (t) {
        var c = center(t), dx = c.x - (ac.x + dir * 40), dy = c.y - ac.y, len = Math.sqrt(dx * dx + dy * dy), ang = Math.atan2(dy, dx) * 180 / Math.PI;
        var b = fxEl('fx-beam', ac.x + dir * 40, ac.y, fx, 'width:' + len + 'px;' + (isUlt ? 'height:44px;margin-top:-22px;' : ''));
        anim(b, [{ transform: 'rotate(' + ang + 'deg) scaleX(0)', opacity: 1 }, { transform: 'rotate(' + ang + 'deg) scaleX(1)', opacity: 1, offset: .35 }, { transform: 'rotate(' + ang + 'deg) scaleX(1) scaleY(.6)', opacity: 0 }], 520).then(function () { kill(b); });
      });
      await wait(180);
    } else if (fam === 'aoe' || fam === 'genjutsu' || fam === 'summon') {
      if (fam === 'summon') {
        var puff = fxEl('fx-ring', ac.x, ac.y + 40, { c1: '#ffffff', c2: '#e0e0e0' });
        anim(puff, [{ opacity: 1, transform: 'scale(.3)' }, { opacity: 0, transform: 'scale(1.6)' }], 420).then(function () { kill(puff); });
        var drop = fxEl('fx-drop', tc.x, tc.y, fx, isUlt ? 'width:380px;height:380px;margin:-190px 0 0 -190px' : '');
        await anim(drop, [{ opacity: 0, transform: 'translateY(-420px) scale(.6)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], 380, { easing: 'cubic-bezier(.6,0,1,.6)' });
        anim(drop, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.5)' }], 360).then(function () { kill(drop); });
        shake(isUlt ? 2 : 1);
      } else if (fam === 'genjutsu') {
        var tint = fxEl('fx-tint', 0, 0, fx, 'left:0;top:0;width:1280px;height:720px');
        anim(tint, [{ opacity: 0 }, { opacity: .85, offset: .3 }, { opacity: 0 }], 900).then(function () { kill(tint); });
        foes.forEach(function (t) {
          var c = center(t), g = fxEl('fx-glyph', c.x, c.y - 10, fx); g.textContent = fx.k || '幻';
          anim(g, [{ opacity: 0, transform: 'scale(2)' }, { opacity: 1, transform: 'scale(1)', offset: .3 }, { opacity: 0, transform: 'scale(.9)' }], 700).then(function () { kill(g); });
        });
        await wait(260);
      } else {
        var wv = fxEl('fx-wave', tc.x, tc.y + 40, fx, isUlt ? 'width:760px;height:420px;margin:-210px 0 0 -380px' : '');
        anim(wv, [{ opacity: 0, transform: 'scale(.2)' }, { opacity: 1, transform: 'scale(1)', offset: .45 }, { opacity: 0, transform: 'scale(1.15)' }], 700).then(function () { kill(wv); });
        await wait(260); shake(isUlt ? 2 : 1);
      }
    } else {
      // projectile / burst: travelling orbs (arc)
      var ps = foes.map(function (t, i) {
        var c = center(t), cls = fam === 'projectile' ? 'fx-star' : 'fx-ball';
        var o = fxEl(cls, ac.x + dir * 40, ac.y, fx, isUlt ? 'width:70px;height:70px;margin:-35px 0 0 -35px' : '');
        var dx = c.x - (ac.x + dir * 40), dy = c.y - ac.y, mid = 'translate(' + dx / 2 + 'px,' + (dy / 2 - 60) + 'px) rotate(360deg)';
        return anim(o, [{ transform: 'translate(0,0) rotate(0)' }, { transform: mid }, { transform: 'translate(' + dx + 'px,' + dy + 'px) rotate(720deg)' }], 340 + i * 30, { easing: 'linear' }).then(function () { kill(o); });
      });
      await Promise.all(ps);
    }
    return null;
  }
  function avg(pts) { var x = 0, y = 0; pts.forEach(function (p) { x += p.x; y += p.y; }); return { x: x / pts.length, y: y / pts.length }; }

  function impactFx(t, fam, fx, isUlt) {
    if (B.skip) return;
    var c = center(t), s = isUlt ? 1.35 : 1;
    if (fam === 'slash') {
      var rot = Math.random() * 60 - 30;
      [0, 1].forEach(function (i) {
        var sl = fxEl('fx-slash', c.x, c.y, fx);
        anim(sl, [{ opacity: 0, transform: 'rotate(' + (rot + i * 70 - 35) + 'deg) scale(' + (.5 * s) + ')' }, { opacity: 1, transform: 'rotate(' + (rot + i * 70 - 5) + 'deg) scale(' + (1 * s) + ')', offset: .35 }, { opacity: 0, transform: 'rotate(' + (rot + i * 70 + 15) + 'deg) scale(' + (1.2 * s) + ')' }], 300, { delay: i * 50 }).then(function () { kill(sl); });
      });
    } else if (fam === 'beam') {
      var sp = fxEl('fx-ring', c.x, c.y, fx, 'width:90px;height:90px;margin:-45px 0 0 -45px');
      anim(sp, [{ opacity: 1, transform: 'scale(.3)' }, { opacity: 0, transform: 'scale(' + 1.5 * s + ')' }], 320).then(function () { kill(sp); });
    } else if (fam === 'genjutsu') {
      var rp = fxEl('fx-ripple', c.x, c.y, fx);
      anim(rp, [{ opacity: 1, transform: 'scale(.2)' }, { opacity: 0, transform: 'scale(' + 1.3 * s + ')' }], 520).then(function () { kill(rp); });
    } else {
      var bu = fxEl('fx-burst', c.x, c.y, fx);
      anim(bu, [{ opacity: 1, transform: 'scale(.15)' }, { opacity: .95, transform: 'scale(' + .9 * s + ')', offset: .4 }, { opacity: 0, transform: 'scale(' + 1.25 * s + ')' }], 420).then(function () { kill(bu); });
    }
    for (var i = 0; i < (isUlt ? 7 : 4); i++) {
      var sk = fxEl('fx-spark', c.x, c.y, fx), ang = Math.random() * Math.PI * 2, dist = 50 + Math.random() * 70;
      anim(sk, [{ opacity: 1, transform: 'translate(0,0) scale(1.2)' }, { opacity: 0, transform: 'translate(' + Math.cos(ang) * dist + 'px,' + Math.sin(ang) * dist + 'px) scale(.3)' }], 420).then((function (s2) { return function () { kill(s2); }; })(sk));
    }
  }

  async function selfCast(a, list, fam, fx, tk) {
    list.forEach(function (t) {
      var c = center(t);
      if (fam === 'heal') {
        var r = fxEl('fx-ring', c.x, c.y + 60, fx, 'height:40px;margin-top:-20px;width:150px;margin-left:-75px');
        anim(r, [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)', offset: .3 }, { opacity: 0, transform: 'scale(1.2)' }], 700).then(function () { kill(r); });
        for (var i = 0; i < 4; i++) {
          var p = fxEl('fx-plus', c.x + (Math.random() * 80 - 40), c.y + 30, fx);
          anim(p, [{ opacity: 0, transform: 'translateY(0) scale(.6)' }, { opacity: 1, transform: 'translateY(-40px) scale(1)', offset: .3 }, { opacity: 0, transform: 'translateY(-110px) scale(.8)' }], 800, { delay: i * 90 }).then((function (q) { return function () { kill(q); }; })(p));
        }
      } else if (fam === 'shield') {
        var h = fxEl('fx-hex', c.x, c.y + 20, fx);
        anim(h, [{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'scale(1.05)', offset: .3 }, { opacity: .9, transform: 'scale(1)', offset: .7 }, { opacity: 0, transform: 'scale(1.1)' }], 800).then(function () { kill(h); });
      } else {
        var pl = fxEl('fx-pillar', c.x, c.y + 80, fx);
        anim(pl, [{ opacity: 0, transform: 'scaleY(.2)' }, { opacity: 1, transform: 'scaleY(1.1)', offset: .35 }, { opacity: 0, transform: 'scaleY(1.3)' }], 760).then(function () { kill(pl); });
        for (var j = 0; j < 4; j++) {
          var s = fxEl('fx-spark', c.x + (Math.random() * 90 - 45), c.y + 40, fx);
          anim(s, [{ opacity: 0, transform: 'translateY(0)' }, { opacity: 1, transform: 'translateY(-50px)', offset: .3 }, { opacity: 0, transform: 'translateY(-140px)' }], 800, { delay: j * 80 }).then((function (q) { return function () { kill(q); }; })(s));
        }
      }
    });
    await wait(380);
  }

  /* ---------------- ULT cut-in ---------------- */
  async function cutIn(a, act, fx, tk) {
    if (B.skip) return;
    var c = a.c, name = act.name || ((U.skill(c, 'ult') || {}).name) || '奥义';
    var ci = U.h('<div class="cutin ' + a.side + '" style="--c1:' + fx.c1 + ';--c2:' + fx.c2 + '"><div class="dim"></div><div class="band"></div>' +
      '<div class="who"><img src="' + U.bustURL(c) + '" alt=""></div><div class="sname' + (name.length > 7 ? ' xlong' : name.length > 5 ? ' long' : '') + '">' + U.esc(name) + '</div>' +
      (c.quote ? '<div class="quote">' + U.esc(c.quote) + '</div>' : '') + '<div class="cflash"></div></div>');
    U.$('#fx').appendChild(ci);
    var dur = 1500 / Math.sqrt(speed());
    await new Promise(function (res) {
      var w = function () { clearTimeout(t); res(); };
      var t = setTimeout(function () { var i = B.wakers.indexOf(w); if (i >= 0) B.wakers.splice(i, 1); res(); }, dur);
      B.wakers.push(w);
    });
    ci.classList.add('out'); kill(ci, 220);
    if (!alive(tk)) { ci.remove(); return; }
    var fl = fxEl('fx-flash', 0, 0, fx, 'left:0;top:0;width:1280px;height:720px');
    anim(fl, [{ opacity: .75 }, { opacity: 0 }], 380).then(function () { kill(fl); });
    await wait(140);
  }

  /* ---------------- result ---------------- */
  function finish(tk) {
    if (B.finished || tk !== B.token) return;
    B.finished = true;
    var rec = B.rec, sid = B.stage;
    // grant rewards right away (even if the player leaves before the result popup appears)
    var res = U.call('finishStage', sid, rec) || { win: rec.winner === 'A', stars: rec.winner === 'A' ? rec.stars : 0, rewards: {} };
    setTimeout(function () {
      if (tk !== B.token) return;
      showResult(res, sid);
      if (res.playerLvUp > 0) setTimeout(function () { U.toast('忍者等级提升！当前 Lv.' + ((U.state().player || {}).lv || ''), 'ok'); }, 900);
    }, B.skip ? 250 : 700);
  }
  function showResult(res, sid) {
    var win = !!res.win, stars = win ? (res.stars || 0) : 0, rw = res.rewards || {};
    var next = win && U.nextStageId ? U.nextStageId(sid) : null;
    var nextOk = next && (U.call('stageState', next) || {}).unlocked;
    var rwHTML = Object.keys(rw).filter(function (k) { return rw[k] > 0 && U.CUR[k]; }).map(function (k, i) { return U.rewardHTML(k, rw[k]).replace('class="rw"', 'class="rw" style="animation-delay:' + (0.5 + i * 0.08) + 's"'); }).join('');
    var html = (win ? '<div class="rrays"></div><div class="rbig gold-text">胜利</div>' : '<div class="rbig">失败</div>') +
      '<div class="rstars">' + [1, 2, 3].map(function (i) { return '<img src="' + U.iconURL(i <= stars ? 'starOn' : 'starOff') + '" alt="" class="' + (i <= stars ? '' : 'dim') + '">'; }).join('') + '</div>' +
      (win ? '<div class="rsub">' + (res.firstClear ? '<b style="color:#ff9b7a">首次通关！</b> ' : '') + (stars >= 3 ? '完美通关：无人阵亡' : stars === 2 ? '阵亡不超过2人' : '惊险取胜') + '</div>' +
        '<div class="rrw">' + (rwHTML || '<span class="muted">无额外奖励</span>') + '</div>'
        : '<div class="rsub">胜败乃兵家常事，提升实力后再来挑战吧！</div><div class="tips"><button data-go="train"><span class="qk">培</span>升级忍者</button><button data-go="team"><span class="qk">阵</span>调整编队</button><button data-go="summon"><span class="qk">召</span>招募忍者</button></div>');
    var btns = [{ html: '返 回', cls: 'dark', fn: function () { U.go('campaign', { stage: win && nextOk ? next : sid }, { replace: true }); } },
      { html: '重 试', cls: 'blue', fn: function () { U.go('battle', { stage: sid, t: Date.now() }, { replace: true }); } }];
    if (win && nextOk) btns.push({ html: '下一关', cls: 'red shine', fn: function () { U.go('battle', { stage: next, t: Date.now() }, { replace: true }); } });
    var m = U.modal({ cls: 'res ' + (win ? 'win' : 'lose'), close: false, maskClose: false, html: html, buttons: btns });
    U.$$('.rstars img', m.el).forEach(function (im, i) { if (i < stars) setTimeout(function () { im.classList.add('pop'); }, 350 + i * 220); });
    U.$$('[data-go]', m.el).forEach(function (b) { b.addEventListener('click', function () { var g = b.getAttribute('data-go'); m.close(); U.go(g); }); });
  }
})();
