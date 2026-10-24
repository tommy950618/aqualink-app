/* 忍界传说 · ui-train.js — 培养 (the reference screenshot layout): left avatar column, center hero art +
 * name plate, right 技能 / 属性 / 升星 panel, skill detail popup, level / star / skill upgrades. */
(function () {
  'use strict';
  var NG = window.NG, U = NG.ui;
  var T = { list: [], id: null, tab: 'skill', items: {} };
  var STAT_ROWS = [
    ['hp', '生命', 'n'], ['atk', '攻击', 'n'], ['def', '防御', 'n'], ['spd', '速度', 'n'],
    ['crit', '暴击', 'p'], ['critDmg', '暴伤', 'p'], ['dodge', '闪避', 'p'], ['dr', '减伤', 'p'],
    ['dmg', '增伤', 'p'], ['lifesteal', '吸血', 'p']
  ];
  var TABS = { skill: '技能', attr: '属性', star: '升星' };

  function sortedOwned() {
    var st = U.state(), team = (st.team || []).filter(function (id) { return U.owned(id) && U.char(id); });
    var rest = U.ownedList().filter(function (x) { return team.indexOf(x.id) < 0; }).map(function (x) { return x.id; });
    return team.concat(rest);
  }
  function entry(id) { return U.owned(id) || { lv: 1, star: 1, shards: 0, skills: {} }; }
  function statFmt(v, kind) { if (v == null || isNaN(v)) return '-'; return kind === 'p' ? U.pct(v) : U.fmt(Math.round(v)); }

  U.screen('train', {
    title: '培养', bg: 'city_night', particles: 'spark', cur: ['coins', 'scrolls', 'gems'],
    build: function (el) {
      el.innerHTML =
        '<div class="tr-list"></div>' +
        '<div class="tr-hero"><div class="aura"></div><div class="bust-wrap"><img alt=""></div>' +
        '<button class="tr-arrow prev" aria-label="上一个"><img src="' + U.iconURL('arrow') + '" alt=""></button><button class="tr-arrow next" aria-label="下一个"><img src="' + U.iconURL('arrow') + '" alt=""></button>' +
        '<div class="tr-meta"></div>' +
        '<div class="tr-plate"><div class="tr-namerow"><div class="tr-emb"><img alt=""></div><div><div class="tr-nm"><span class="n"></span><button class="info" aria-label="详情"><img src="' + U.iconURL('info') + '" alt=""></button></div><div class="tr-en"></div></div></div>' +
        '<div class="tr-stars"></div><div class="tr-form"></div><div class="tr-chips"></div></div><div class="lvburst"></div></div>' +
        '<div class="tr-panel"><div class="wtitle"><img src="' + U.iconURL('wings') + '" alt=""><span>技能</span></div><div class="pbody"></div>' +
        '<div class="tr-content"></div><div class="tr-tabbar"><button data-tab="skill">技<br>能</button><button data-tab="attr">属<br>性</button><button data-tab="star">升<br>星</button></div></div>' +
        '<div class="tr-empty hidden" style="position:absolute;left:0;right:0;top:300px;text-align:center"><div style="font-size:30px;font-weight:900;text-shadow:var(--stroke2)">尚未拥有任何忍者</div><button class="btn red lg shine" style="margin-top:22px">前往召唤</button></div>';
      U.scroller(U.$('.tr-list', el));
      U.$('.tr-arrow.prev', el).addEventListener('click', function () { step(-1); });
      U.$('.tr-arrow.next', el).addEventListener('click', function () { step(1); });
      U.$('.tr-nm .info', el).addEventListener('click', function () { if (T.id && U.codexDetail) U.codexDetail(T.id); });
      U.$$('.tr-tabbar button', el).forEach(function (b) { b.addEventListener('click', function () { T.tab = b.getAttribute('data-tab'); renderTab(); }); });
      U.$('.tr-empty .btn', el).addEventListener('click', function () { U.go('summon'); });
      // swipe on hero to switch character
      var hero = U.$('.tr-hero', el), sw = null;
      hero.addEventListener('pointerdown', function (e) { if (e.target.closest('button')) return; sw = { p: U.toStage(e.clientX, e.clientY), t: performance.now(), id: e.pointerId }; });
      window.addEventListener('pointerup', function (e) {
        if (!sw || e.pointerId !== sw.id) return;
        var p = U.toStage(e.clientX, e.clientY), dx = p.x - sw.p.x, dy = p.y - sw.p.y; sw = null;
        if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.4) step(dx < 0 ? 1 : -1);
      });
      document.addEventListener('keydown', function (e) {
        if (U.current() !== 'train' || document.querySelector('#modals .mask')) return;
        if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1);
      });
      T.el = el;
    },
    show: function (el, params) {
      T.list = sortedOwned();
      var empty = !T.list.length;
      U.$('.tr-empty', el).classList.toggle('hidden', !empty);
      ['.tr-list', '.tr-hero', '.tr-panel'].forEach(function (s) { U.$(s, el).style.visibility = empty ? 'hidden' : ''; });
      if (empty) return;
      if (params && params.id && T.list.indexOf(params.id) >= 0) T.id = params.id;
      if (!T.id || T.list.indexOf(T.id) < 0) T.id = T.list[0];
      if (params && params.tab && TABS[params.tab]) T.tab = params.tab;
      renderList();
      renderHero(0);
      renderTab();
    },
    onChange: function (w) {
      if (!T.id) return;
      if (w && (w.reset || w.summon || w.team)) { this.show(this.el, {}); return; }
      renderHero(null); renderTab(true); updItem(T.id);
    }
  });

  function step(d) {
    if (!T.list.length) return;
    var i = T.list.indexOf(T.id); i = (i + d + T.list.length) % T.list.length;
    select(T.list[i], d);
  }
  function select(id, dir) {
    if (id === T.id && dir == null) return;
    var prev = T.id; T.id = id;
    if (prev && T.items[prev]) { var a = U.$('.av', T.items[prev]); if (a) a.classList.remove('sel'); }
    var it = T.items[id];
    if (it) {
      U.$('.av', it).classList.add('sel');
      var lst = U.$('.tr-list', T.el), top = it.offsetTop - lst.clientHeight / 2 + 62;
      if (it.offsetTop < lst.scrollTop || it.offsetTop + 124 > lst.scrollTop + lst.clientHeight) lst.scrollTo ? lst.scrollTo({ top: top, behavior: 'smooth' }) : (lst.scrollTop = top);
    }
    renderHero(dir == null ? 1 : dir);
    renderTab();
  }

  function itemHTML(id) {
    var c = U.char(id), e = entry(id), inTeam = (U.state().team || []).indexOf(id) >= 0;
    return '<button class="tr-item" data-id="' + U.esc(id) + '">' + U.avatarHTML(c, { size: 84, lv: e.lv, sel: id === T.id, lazy: true }) +
      '<div class="wing"><img src="' + U.iconURL('wingBadge') + '" alt=""><span>' + (e.star || 1) + '★</span></div>' + (inTeam ? '<span class="tm">阵</span>' : '') + '</button>';
  }
  function renderList() {
    var box = U.$('.tr-list', T.el); box.innerHTML = ''; T.items = {};
    U.chunked(box, T.list, function (id) {
      var b = U.h(itemHTML(id)); T.items[id] = b;
      b.addEventListener('click', function () { if (id !== T.id) { var d = T.list.indexOf(id) > T.list.indexOf(T.id) ? 1 : -1; select(id, d); } });
      return b;
    }, { size: 8, later: 24, done: function () {
      // bring the selected ninja into view once the list exists (it may sit far down a 180-ninja roster)
      var i = T.list.indexOf(T.id);
      if (i > 3) box.scrollTop = Math.max(0, i * 128 - 200);
    } });
    box.scrollTop = 0;
  }
  function updItem(id) {
    var it = T.items[id]; if (!it) return;
    var e = entry(id), lv = U.$('.av-lv', it); if (lv) lv.textContent = 'Lv.' + e.lv;
    var s = U.$('.wing span', it); if (s) s.textContent = (e.star || 1) + '★';
  }

  function renderHero(dir) {
    var el = T.el, id = T.id, c = U.char(id); if (!c) return;
    var e = entry(id), r = U.rarity(c);
    var wrap = U.$('.bust-wrap', el), img = U.$('img', wrap), url = U.bustURL(c);
    if (img.getAttribute('src') === url) wrap._want = null;          // cancels a pending load of another bust
    else if (wrap._want !== url) {
      // the big bust SVG parses synchronously on src assignment: do it in its own frame, after the
      // name plate / panel update has painted (rapid arrow taps only load the last one)
      wrap._want = url;
      requestAnimationFrame(function () {
        if (wrap._want !== url) return;
        wrap._want = null; img.src = url;
        if (dir != null) { wrap.classList.remove('swap-l', 'swap-r'); void wrap.offsetWidth; wrap.classList.add(dir < 0 ? 'swap-l' : 'swap-r'); }
      });
    }
    U.$('.tr-hero', el).style.setProperty('--aura', (c.art && c.art.aura) || U.rcolor(c));
    var emb = U.$('.tr-emb img', el); emb.src = U.emblemURL(c.faction, 64);
    var nm = U.charName(c);
    U.$('.tr-nm .n', el).textContent = nm;
    U.$('.tr-nm', el).style.fontSize = nm.length > 5 ? '38px' : '';
    U.$('.tr-en', el).textContent = c.en || '';
    U.$('.tr-stars', el).innerHTML = U.starsHTML(e.star || 1);
    var fm = U.$('.tr-form', el); fm.textContent = U.charForm(c) || '忍者';
    U.$('.tr-chips', el).innerHTML = U.chipsHTML(c.tags);
    var el2 = NG.ELEMENTS && NG.ELEMENTS[c.element];
    U.$('.tr-meta', el).innerHTML = U.rarHTML(r) +
      '<div class="pw"><img src="' + U.iconURL('power') + '" alt="">战力 ' + U.fmt(U.call('power', id) || 0) + '</div>' +
      '<div class="el">' + (el2 ? '<img src="' + U.elementURL(c.element) + '" alt="">' + el2.name + '属性' : '') + U.roleHTML(c.role) + '</div>';
  }

  function renderTab(soft) {
    var el = T.el, box = U.$('.tr-content', el);
    U.$('.wtitle span', el).textContent = TABS[T.tab];
    U.$$('.tr-tabbar button', el).forEach(function (b) {
      var k = b.getAttribute('data-tab'); b.classList.toggle('on', k === T.tab);
      var dot = U.$('.dot', b); var need = k === 'star' && canStar(T.id);
      if (need && !dot) b.insertAdjacentHTML('beforeend', '<i class="dot"></i>'); else if (!need && dot) dot.remove();
    });
    if (T.tab === 'skill') renderSkills(box, soft);
    else if (T.tab === 'attr') renderAttr(box);
    else renderStar(box);
  }
  function lenCls(t, a, b) { var n = String(t || '').length; return n > b ? ' xlong' : n > a ? ' long' : ''; }
  function canStar(id) { var e = U.owned(id), c = U.call('starCost', id); return !!(e && c != null && (e.shards || 0) >= c); }

  /* ---------------- 技能 ---------------- */
  function renderSkills(box, soft) {
    var id = T.id, c = U.char(id), e = entry(id);
    var html = '<div class="sk-list">';
    (NG.SKILL_KEYS || ['passive', 's1', 's2', 'ult', 'awaken']).forEach(function (k) {
      var sk = U.skill(c, k) || { name: '未知技能', tags: [] };
      var unlocked = U.call('skillUnlocked', id, k); if (unlocked === undefined) unlocked = k !== 'awaken' || (e.star || 1) >= (NG.AWAKEN_STAR || 4);
      var lv = (e.skills && e.skills[k]) || 1;
      html += '<button class="sk' + (unlocked ? '' : ' locked') + '" data-k="' + k + '"' + (soft ? ' style="animation:none"' : '') + '>' +
        '<div class="sk-ic"><img src="' + U.skillIconURL(c, k) + '" alt=""><span class="sk-lv"><b>' + lv + '</b></span></div>' +
        '<div class="sk-main"><span class="sk-label">' + U.esc((NG.SKILL_LABELS || {})[k] || k) + '</span><div class="sk-name' + lenCls(sk.name, 8, 10) + '">' + U.esc(sk.name) + '</div><div class="sk-line"></div><div class="sk-tags">' + U.chipsHTML(sk.tags) + '</div></div>' +
        '<span class="sk-badge">' + (unlocked ? '已解锁' : '★' + (NG.AWAKEN_STAR || 4) + '解锁') + '</span><img class="sk-i" src="' + U.iconURL('info') + '" alt=""></button>';
    });
    box.innerHTML = html + '</div>';
    U.$$('.sk', box).forEach(function (b) { b.addEventListener('click', function () { skillModal(b.getAttribute('data-k')); }); });
    if (T.flash && performance.now() - T.flash.t < 800) { var fc = U.$('.sk[data-k="' + T.flash.k + '"]', box); if (fc) fc.classList.add('up'); }
  }
  function skillMetaText(sk, k) {
    var t = [];
    var tg = { single: '单体', all: '敌方全体', random: '随机' + (sk.count || '') + '名敌人', lowest: '生命最低的敌人', highest_atk: '攻击最高的敌人', back: '后排敌人', self: '自身', ally_lowest: '生命最低的友方', ally_all: '友方全体', ally_random: '随机友方' };
    if (k === 'passive' || k === 'awaken') t.push('被动技能');
    else { if (sk.target) t.push('目标：' + (tg[sk.target] || sk.target)); t.push(k === 'ult' ? '消耗：100查克拉' : (sk.cd ? '冷却：' + sk.cd + '回合' : '普通攻击')); }
    var fx = NG.FX && NG.FX[sk.fx]; if (fx) t.push(fx.n);
    return t;
  }
  function skillModal(k) {
    var id = T.id, c = U.char(id);
    var m = U.modal({ title: (NG.SKILL_LABELS || {})[k] || '技能', cls: 'skd' });
    function draw() {
      var e = entry(id), sk = U.skill(c, k) || { name: '未知技能', desc: '暂无技能说明', tags: [] }, lv = (e.skills && e.skills[k]) || 1;
      var unlocked = U.call('skillUnlocked', id, k); if (unlocked === undefined) unlocked = k !== 'awaken' || (e.star || 1) >= (NG.AWAKEN_STAR || 4);
      var cost = U.call('skillCost', id, k), st = U.state(), val = U.call('skillValue', id, k);
      var max = NG.MAX_SKILL_LV || 10;
      var html = '<div class="skd-top"><div class="sk-ic"><img src="' + U.skillIconURL(c, k) + '" alt=""><span class="sk-lv"><b>' + lv + '</b></span></div>' +
        '<div><div class="nm">' + U.esc(sk.name) + '</div><div class="lv">等级 ' + lv + ' / ' + max + (unlocked ? '' : '　<span style="color:#ff9b7a">★' + (NG.AWAKEN_STAR || 4) + '解锁</span>') + '</div><div class="chips" style="margin-top:6px">' + U.chipsHTML(sk.tags) + '</div></div></div>' +
        '<div class="skd-desc">' + U.esc(sk.desc || '暂无技能说明') + '<div class="meta">' + skillMetaText(sk, k).map(U.esc).join('<span>·</span>') + '</div></div>' +
        (typeof val === 'number' ? '<div class="skd-bonus">当前技能效果加成：' + U.pct(val - 1) + '（每级提升技能效果）</div>' : '');
      if (!unlocked) html += '<div class="skd-up"><div class="muted">升至★' + (NG.AWAKEN_STAR || 4) + '后解锁突破技能</div><button class="btn sm" data-a="star">前往升星</button></div>';
      else if (!cost) html += '<div class="skd-up"><div style="color:#ffe9a6;font-weight:900">技能已满级</div></div>';
      else {
        var lc = (st.coins || 0) < (cost.coins || 0), ls = (st.scrolls || 0) < (cost.scrolls || 0);
        html += '<div class="skd-up"><div class="costs"><span class="' + (lc ? 'lack' : '') + '"><img src="' + U.iconURL('coin') + '" alt="">' + U.fmt(cost.coins || 0) + '</span><span class="' + (ls ? 'lack' : '') + '"><img src="' + U.iconURL('scroll') + '" alt="">' + U.fmt(cost.scrolls || 0) + '</span></div>' +
          '<button class="btn green" data-a="up">升 级</button></div>';
      }
      m.body.innerHTML = html;
      var up = U.$('[data-a="up"]', m.body);
      if (up) up.addEventListener('click', function () {
        var r = U.call('skillUp', id, k);
        if (!r || !r.ok) { U.fail(r, '资源不足'); return; }
        U.toast(sk.name + ' 升至 ' + (((entry(id).skills || {})[k]) || lv + 1) + ' 级', 'ok');
        draw();
        T.flash = { k: k, t: performance.now() };
        var card = U.$('.sk[data-k="' + k + '"]', T.el); if (card) { card.classList.remove('up'); void card.offsetWidth; card.classList.add('up'); }
      });
      var sb = U.$('[data-a="star"]', m.body);
      if (sb) sb.addEventListener('click', function () { m.close(); T.tab = 'star'; renderTab(); });
    }
    draw();
  }

  /* ---------------- 属性 ---------------- */
  function maxAffordable(id, left) {
    var coins = U.state().coins || 0, lo = 0, hi = left;
    while (lo < hi) { var mid = Math.ceil((lo + hi) / 2), c = U.call('levelCost', id, mid); if (c != null && c <= coins) lo = mid; else hi = mid - 1; }
    return lo;
  }
  function renderAttr(box) {
    var id = T.id, e = entry(id), s = U.call('stats', id) || {}, cap = U.call('maxLevel', id) || (NG.STAR_LEVEL_CAP || [])[e.star || 1] || 100;
    var nxt = e.lv < cap ? U.call('stats', id, Object.assign({}, e, { lv: e.lv + 1 })) : null;
    var html = '<div class="at-lv"><div class="big num">Lv.' + e.lv + '<small> / ' + cap + '</small></div><div class="pw"><img src="' + U.iconURL('power') + '" alt="">战力 ' + U.fmt(s.power || U.call('power', id) || 0) + '</div></div>' +
      '<div class="at-bar"><i style="width:' + U.clamp(e.lv / cap, 0, 1) * 100 + '%"></i></div><div class="at-grid">';
    STAT_ROWS.forEach(function (r) {
      var v = s[r[0]], d = nxt && nxt[r[0]] != null && v != null ? nxt[r[0]] - v : 0;
      html += '<div class="at-cell"><span class="k">' + r[1] + '</span><span class="v num">' + statFmt(v, r[2]) + '</span><span class="d">' + (d > 0 ? '+' + (r[2] === 'p' ? U.pct(d) : U.fmt(Math.round(d))) : '') + '</span></div>';
    });
    html += '</div>';
    if (e.lv >= cap) {
      html += '<div class="at-cap">已达当前星级等级上限 Lv.' + cap + '，升星可提升上限</div><div class="at-btns"><button class="btn" data-a="gostar">前往升星</button></div>';
    } else {
      var left = cap - e.lv, n10 = Math.min(10, left), coins = U.state().coins || 0;
      var c1 = U.call('levelCost', id, 1) || 0, c10 = U.call('levelCost', id, n10) || 0, cmax = U.call('levelCost', id, left) || 0;
      var aff = cmax <= coins ? left : maxAffordable(id, left);
      html += '<div class="at-btns">' +
        '<button class="btn blue" data-n="1">升1级<span class="cost' + (c1 > coins ? ' lack' : '') + '"><img src="' + U.iconURL('coin') + '" alt="">' + U.fmt(c1) + '</span></button>' +
        '<button class="btn blue" data-n="' + n10 + '">升' + n10 + '级<span class="cost"><img src="' + U.iconURL('coin') + '" alt="">' + U.fmt(c10) + '</span></button>' +
        '<button class="btn shine" data-n="max">一键满级<span class="cost"><img src="' + U.iconURL('coin') + '" alt="">' + (aff >= left ? U.fmt(cmax) : (aff > 0 ? '可升至Lv.' + (e.lv + aff) : U.fmt(cmax))) + '</span></button></div>';
    }
    box.innerHTML = html;
    U.$$('[data-n]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        var e2 = entry(id), cap2 = U.call('maxLevel', id) || cap, left2 = cap2 - e2.lv, n = b.getAttribute('data-n');
        n = n === 'max' ? maxAffordable(id, left2) : Math.min(Number(n), left2);
        if (n <= 0) { U.toast(left2 <= 0 ? '已达等级上限' : '铜币不足', 'err'); return; }
        var r = U.call('levelUp', id, n);
        if (!r || !r.ok) { U.fail(r, '铜币不足'); return; }
        lvFx(r.gained || n);
      });
    });
    var gs = U.$('[data-a="gostar"]', box); if (gs) gs.addEventListener('click', function () { T.tab = 'star'; renderTab(); });
  }
  function lvFx(n) {
    var hero = U.$('.tr-hero', T.el);
    var wrap = U.h('<div style="position:absolute;inset:0;pointer-events:none;z-index:5;--c1:#4fe3ff;--c2:#eafffb"></div>');
    var ring = U.h('<div class="fxe fx-ring" style="left:340px;top:560px;width:300px;height:90px;margin:-45px 0 0 -150px"></div>');
    var pil = U.h('<div class="fxe fx-pillar" style="left:340px;top:600px;width:420px;height:560px;margin:-560px 0 0 -210px"></div>');
    var txt = U.h('<div class="dmg txt" style="left:340px;top:330px;--c:#7dff9a;font-size:40px">等级 +' + n + '</div>');
    wrap.appendChild(pil); wrap.appendChild(ring); wrap.appendChild(txt);
    for (var i = 0; i < 12; i++) {
      var sp = U.h('<div class="fxe fx-spark" style="left:' + (200 + Math.random() * 280) + 'px;top:' + (520 + Math.random() * 120) + 'px;width:14px;height:14px"></div>');
      wrap.appendChild(sp);
      sp.animate([{ opacity: 0, transform: 'translateY(0) scale(.6)' }, { opacity: 1, transform: 'translateY(-90px) scale(1.2)', offset: .35 }, { opacity: 0, transform: 'translateY(-300px) scale(.5)' }], { duration: 900 + Math.random() * 400, delay: Math.random() * 250, easing: 'ease-out', fill: 'both' });
    }
    hero.appendChild(wrap);
    ring.animate([{ opacity: 1, transform: 'scale(.3)' }, { opacity: 0, transform: 'scale(1.6)' }], { duration: 700, easing: 'ease-out', fill: 'both' });
    pil.animate([{ opacity: 0, transform: 'scaleY(.3)' }, { opacity: .85, transform: 'scaleY(1)', offset: .3 }, { opacity: 0, transform: 'scaleY(1.15)' }], { duration: 900, easing: 'ease-out', fill: 'both' });
    setTimeout(function () { wrap.remove(); }, 1500);
  }

  /* ---------------- 升星 ---------------- */
  function renderStar(box, popAt) {
    var id = T.id, c = U.char(id), e = entry(id), cost = U.call('starCost', id), max = NG.MAX_STAR || 6;
    var caps = NG.STAR_LEVEL_CAP || [], star = e.star || 1;
    var html = '<div class="st-stars">' + U.starsHTML(star, max) + '</div>' +
      '<div class="st-sh">' + U.avatarHTML(c, { size: 64 }) + '<div class="bar"><i style="width:' + (cost ? U.clamp((e.shards || 0) / cost, 0, 1) * 100 : 100) + '%"></i><span>' + (cost != null ? '碎片 ' + (e.shards || 0) + ' / ' + cost : '已满星 · 碎片 ' + (e.shards || 0)) + '</span></div></div>';
    if (cost != null) {
      var cur = U.call('stats', id) || {}, nx = U.call('stats', id, Object.assign({}, e, { star: star + 1 })) || {};
      html += '<div class="st-ben"><div class="h">★' + star + ' → ★' + (star + 1) + ' 升星效果</div>' +
        '等级上限：' + (caps[star] || '-') + ' → <b>' + (caps[star + 1] || '-') + '</b><br>' +
        (cur.atk && nx.atk ? '攻击：' + U.fmt(cur.atk) + ' → <b>' + U.fmt(nx.atk) + '</b>　生命：' + U.fmt(cur.hp) + ' → <b>' + U.fmt(nx.hp) + '</b><br>' : '') +
        (star + 1 === (NG.AWAKEN_STAR || 4) ? '<span class="lock">解锁突破技能：' + U.esc((U.skill(c, 'awaken') || {}).name || '突破') + '</span>' : (star + 1 < (NG.AWAKEN_STAR || 4) ? '<span class="muted">★' + (NG.AWAKEN_STAR || 4) + '解锁突破技能「' + U.esc((U.skill(c, 'awaken') || {}).name || '突破') + '」</span>' : '<span class="muted">全属性大幅提升</span>')) + '</div>' +
        '<div class="st-btn"><button class="btn lg ' + ((e.shards || 0) >= cost ? 'shine' : 'disabled') + '" data-a="up">升 星</button></div>';
    } else {
      html += '<div class="st-ben" style="text-align:center"><div class="h">已达到最高星级 ★' + max + '</div>等级上限 ' + (caps[max] || '-') + '，突破技能已解锁</div>';
    }
    html += '<div class="st-src">重复召唤获得该忍者可获得碎片（' + (U.rarity(c)) + ' 每次+' + ((NG.RARITIES[U.rarity(c)] || {}).dupShards || 20) + '）</div>';
    html += '<div class="st-caps">' + [1, 2, 3, 4, 5, 6].slice(0, max).map(function (i) { return '<div class="' + (i === star ? 'on' : i < star ? 'done' : '') + '"><b>★' + i + '</b>Lv.' + (caps[i] || '-') + '</div>'; }).join('') + '</div>';
    box.innerHTML = html;
    if (!popAt && T.pop && performance.now() - T.pop.t < 800) popAt = T.pop.n;
    if (popAt) { var im = U.$$('.st-stars img', box)[popAt - 1]; if (im) im.classList.add('pop'); }
    var b = U.$('[data-a="up"]', box);
    if (b) b.addEventListener('click', function () {
      var r = U.call('starUp', id);
      if (!r || !r.ok) { U.fail(r, '碎片不足'); return; }
      var ns = entry(id).star || star + 1;
      T.pop = { n: ns, t: performance.now() };
      U.toast('升星成功！' + U.charName(c) + ' 达到 ★' + ns, 'ok');
      renderStar(box, ns); renderHero(null); updItem(id);
    });
  }
})();
