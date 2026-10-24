/* 忍界传说 · ui-codex.js — 图鉴 (all characters, filters, lazy grid, detail) + 编队 (5 slots, auto team). */
(function () {
  'use strict';
  var NG = window.NG, U = NG.ui;
  var F = { fac: 'all', rar: 'all', role: 'all', own: 'all' };
  var cards = {}, sortedCache = null;

  function sortedChars() {
    if (sortedCache && sortedCache.n === U.chars().length) return sortedCache.list;
    var idx = {}; U.chars().forEach(function (c, i) { idx[c.id] = i; });
    var list = U.chars().slice().sort(function (a, b) {
      return (((NG.RARITIES[b.rarity] || {}).order || 0) - ((NG.RARITIES[a.rarity] || {}).order || 0)) || (idx[a.id] - idx[b.id]);
    });
    sortedCache = { n: list.length, list: list };
    return list;
  }
  function pass(c) {
    if (F.fac !== 'all' && c.faction !== F.fac) return false;
    if (F.rar !== 'all' && c.rarity !== F.rar) return false;
    if (F.role !== 'all' && c.role !== F.role) return false;
    var o = !!U.owned(c.id);
    if (F.own === 'own' && !o) return false;
    if (F.own === 'not' && o) return false;
    return true;
  }
  function cardEl(c) {
    var el = cards[c.id];
    if (!el) {
      el = U.h('<button class="cx-card r-' + U.rarity(c) + '" style="--rc:' + U.rcolor(c) + '" data-id="' + U.esc(c.id) + '">' +
        '<div class="pic"><img data-av="' + U.esc(c.id) + '" data-src="lazy" alt=""></div>' + U.rarHTML(U.rarity(c)) +
        '<img class="emb" src="' + U.emblemURL(c.faction, 64) + '" alt=""><span class="st"></span>' +
        '<div class="nm"><b>' + U.esc(U.charName(c)) + '</b><i>' + U.esc(c.form || c.title || '　') + '</i></div></button>');
      el.addEventListener('click', function () { U.codexDetail(c.id); });
      cards[c.id] = el;
    }
    var e = U.owned(c.id);
    el.classList.toggle('off', !e);
    U.$('.st', el).innerHTML = e ? U.starsHTML(e.star || 1, e.star || 1, 13) : '';
    return el;
  }

  U.screen('codex', {
    title: '图鉴', bg: 'mist', particles: 'spark',
    build: function (el) {
      var facs = Object.keys(NG.FACTIONS || {}).filter(function (k) { return U.chars().some(function (c) { return c.faction === k; }); });
      el.innerHTML = '<div class="cx-filters">' +
        '<div class="cx-row"><span class="lbl">阵营</span><div class="pills fac" data-f="fac"><button class="pill" data-v="all">全部</button>' +
        facs.map(function (k) { return '<button class="pill" data-v="' + k + '">' + U.esc(NG.FACTIONS[k].short || NG.FACTIONS[k].name) + '</button>'; }).join('') + '</div><div class="cx-collect"></div></div>' +
        '<div class="cx-row"><span class="lbl">稀有</span><div class="pills" data-f="rar" style="flex:none"><button class="pill" data-v="all">全部</button>' + ['UR', 'SSR', 'SR', 'R'].map(function (r) { return '<button class="pill" data-v="' + r + '">' + U.rarHTML(r) + '</button>'; }).join('') + '</div>' +
        '<span class="lbl" style="margin-left:10px">定位</span><div class="pills" data-f="role" style="flex:none"><button class="pill" data-v="all">全部</button>' + Object.keys(NG.ROLES || {}).map(function (k) { return '<button class="pill" data-v="' + k + '">' + NG.ROLES[k].name + '</button>'; }).join('') + '</div>' +
        '<span class="lbl" style="margin-left:10px">状态</span><div class="pills" data-f="own" style="flex:none"><button class="pill" data-v="all">全部</button><button class="pill" data-v="own">已拥有</button><button class="pill" data-v="not">未拥有</button></div></div>' +
        '</div><div class="cx-grid"></div>';
      U.scroller(U.$('.pills.fac', el), 'x');
      U.scroller(U.$('.cx-grid', el));
      U.$$('[data-f]', el).forEach(function (g) {
        var k = g.getAttribute('data-f');
        U.$$('.pill', g).forEach(function (p) { p.addEventListener('click', function () { F[k] = p.getAttribute('data-v'); syncPills(el); renderGrid(el); }); });
      });
    },
    show: function (el) { syncPills(el); renderGrid(el); },
    onChange: function (w) { if (w && (w.summon || w.reset || w.roster || w.init)) renderGrid(this.el, true); }
  });
  function syncPills(el) {
    U.$$('[data-f]', el).forEach(function (g) { var k = g.getAttribute('data-f'); U.$$('.pill', g).forEach(function (p) { p.classList.toggle('on', p.getAttribute('data-v') === F[k]); }); });
    var tot = U.chars().length, own = U.chars().filter(function (c) { return U.owned(c.id); }).length;
    U.$('.cx-collect', el).innerHTML = '已收集<b>' + own + '</b>/ ' + tot;
  }
  function renderGrid(el, keepScroll) {
    var grid = U.$('.cx-grid', el), st = grid.scrollTop;
    var list = sortedChars().filter(pass);
    grid.innerHTML = '';
    // stop a previous filter's chunked render before showing the empty state (it would keep appending cards)
    if (!list.length) { grid._chunkToken = null; grid._chunkDone = true; grid.innerHTML = '<div class="cx-empty">没有符合条件的忍者</div>'; syncPills(el); return; }
    U.chunked(grid, list, function (c) { return cardEl(c); }, { size: 20, later: 28 });
    if (keepScroll) grid.scrollTop = st; else grid.scrollTop = 0;
    syncPills(el);
  }

  /* ---------------- detail ---------------- */
  U.codexDetail = function (id) {
    var c = U.char(id); if (!c) return;
    var e = U.owned(id), r = U.rarity(c), fac = (NG.FACTIONS || {})[c.faction], role = (NG.ROLES || {})[c.role], el = (NG.ELEMENTS || {})[c.element];
    var skills = (NG.SKILL_KEYS || []).map(function (k) {
      var s = U.skill(c, k); if (!s) return '';
      return '<div class="cxd-sk"><div class="sk-ic"><img src="' + U.skillIconURL(c, k) + '" alt=""></div><div style="flex:1;min-width:0"><div class="t"><span class="sk-label">' + U.esc((NG.SKILL_LABELS || {})[k] || k) + '</span><b>' + U.esc(s.name) + '</b>' + U.chipsHTML(s.tags, 'sm') + '</div><div class="d">' + U.esc(s.desc || '') + '</div></div></div>';
    }).join('');
    var html = '<div class="cxd-left r-' + r + (e ? '' : ' off') + '" style="--rc:' + U.rcolor(c) + '"><div class="rays"></div><img class="bust" src="' + U.bustURL(c) + '" alt="">' + U.rarHTML(r) +
      '<img class="emb" src="' + U.emblemURL(c.faction, 64) + '" alt=""><div class="own">' + (e ? '已拥有 · Lv.' + e.lv + ' · ' + (e.star || 1) + '★' : '未获得 · 可通过召唤获得') + '</div></div>' +
      '<div class="cxd-right"><div class="nm">' + U.esc(U.charName(c)) + (c.form ? '<small>' + U.esc(c.form) + '</small>' : '') + '</div><div class="en">' + U.esc(c.en || '') + (c.title ? ' · 「' + U.esc(c.title) + '」' : '') + '</div>' +
      '<div class="cxd-tags">' + (fac ? '<span class="meta" style="--c:' + fac.color + '"><img src="' + U.emblemURL(c.faction, 64) + '" alt="">' + U.esc(fac.name) + '</span>' : '') +
      (role ? '<span class="meta" style="--c:' + role.color + '">' + role.name + '</span>' : '') + (el ? '<span class="meta" style="--c:' + el.color + '"><img src="' + U.elementURL(c.element) + '" alt="">' + el.name + '属性</span>' : '') + U.chipsHTML(c.tags) + '</div>' +
      '<div class="cxd-bio">' + U.esc(c.bio || '暂无介绍') + '</div>' + (c.quote ? '<div class="cxd-quote">「' + U.esc(c.quote) + '」</div>' : '') +
      '<div class="cxd-skills scroller">' + skills + '</div>' +
      '<div class="cxd-act">' + (e ? '<button class="btn" data-a="train">前往培养</button>' : '<button class="btn red" data-a="summon">前往召唤</button>') + '</div></div>';
    var m = U.modal({ cls: 'cxd', html: '' });
    m.body.style.display = 'contents';
    m.body.innerHTML = html;
    U.scroller(U.$('.cxd-skills', m.el));
    var t = U.$('[data-a="train"]', m.el); if (t) t.addEventListener('click', function () { m.close(); U.go('train', { id: id }); });
    var s = U.$('[data-a="summon"]', m.el); if (s) s.addEventListener('click', function () { m.close(); U.go('summon'); });
  };

  /* ============================== 编队 Team ============================== */
  var TM = { items: {} };
  U.screen('team', {
    title: '编队', bg: 'forest', particles: 'ember',
    build: function (el) {
      el.innerHTML = '<div class="tm-slots"></div><div class="tm-bar"><div class="tm-power"><img src="' + U.iconURL('power') + '" alt=""><small>队伍战力</small><span class="v num">0</span></div><div class="grow"></div>' +
        '<span class="muted tm-tip" style="font-size:15px">点击下方忍者上阵/下阵，1号位为前排</span>' +
        '<button class="btn dark sm" data-a="clear">清空</button><button class="btn blue sm" data-a="auto">一键上阵</button><button class="btn sm shine" data-a="go">前往冒险</button></div>' +
        '<div class="tm-list panel glass"></div>';
      U.scroller(U.$('.tm-list', el));
      U.$('[data-a="auto"]', el).addEventListener('click', function () {
        var r = U.call('autoTeam'); if (r && r.ok === false) { U.fail(r); return; }
        U.toast('已按战力自动上阵', 'ok'); renderTeam(el, true);
      });
      U.$('[data-a="clear"]', el).addEventListener('click', function () { setTeam([]); renderTeam(el, true); });
      U.$('[data-a="go"]', el).addEventListener('click', function () { if (!team().length) { U.toast('请先选择上阵忍者', 'err'); return; } U.go('campaign'); });
    },
    show: function (el) { renderTeam(el); renderList(el); },
    onChange: function (w) { renderTeam(this.el, true); if (w && (w.summon || w.reset)) renderList(this.el); else syncList(this.el); }
  });
  function team() { return (U.state().team || []).filter(function (id) { return U.owned(id) && U.char(id); }); }
  function setTeam(ids) { var r = U.call('setTeam', ids); if (r && r.ok === false) U.fail(r); }
  var POS = ['1号位 · 前排', '2号位', '3号位', '4号位', '5号位 · 后排'];
  function renderTeam(el, anim) {
    var t = team(), box = U.$('.tm-slots', el), html = '';
    // the engine's 'team' change event re-renders right after the tap handler did: skip identical
    // re-renders so the slot pop-in animation doesn't restart on every add/remove
    var sig = t.map(function (id) { var e = U.owned(id) || {}; return id + ':' + e.lv + ':' + e.star; }).join(',');
    U.$('.tm-power .v', el).textContent = U.fmt(U.call('teamPower') || 0);
    if (box._sig === sig && box.children.length) return;
    var prevIds = box._ids || [];
    box._sig = sig; box._ids = t.slice();
    for (var i = 0; i < 5; i++) {
      var id = t[i], c = id && U.char(id), e = id && U.owned(id);
      var pop = anim || (box._built && prevIds.indexOf(id) < 0);    // only newly placed ninjas pop in
      if (c) html += '<button class="tm-slot filled r-' + U.rarity(c) + '" style="--rc:' + U.rcolor(c) + (pop ? '' : ';animation:none') + '" data-i="' + i + '"><div class="pos">' + POS[i] + '</div><div class="art"><img src="' + U.avatarURL(c, 128) + '" alt=""></div>' + U.rarHTML(U.rarity(c)) +
        (c.form ? '<div class="fmr">' + U.esc(c.form) + '</div>' : '') + '<div class="inf"><b>' + U.esc(U.charName(c)) + '</b><div class="s">Lv.' + e.lv + U.starsHTML(e.star || 1, e.star || 1) + '</div><div class="s" style="color:#ffe9a6">战力 ' + U.fmt(U.call('power', id) || 0) + '</div></div></button>';
      else html += '<button class="tm-slot" data-i="' + i + '"><div class="pos">' + POS[i] + '</div><div class="plus"><i></i>点击下方忍者上阵</div></button>';
    }
    box.innerHTML = html; box._built = true;
    U.$$('.tm-slot.filled', box).forEach(function (b) {
      b.addEventListener('click', function () { var i = Number(b.getAttribute('data-i')), cur = team(); cur.splice(i, 1); setTeam(cur); renderTeam(el); syncList(el); });
    });
    U.$('.tm-power .v', el).textContent = U.fmt(U.call('teamPower') || 0);
  }
  function renderList(el) {
    var box = U.$('.tm-list', el); box.innerHTML = ''; TM.items = {};
    var list = U.ownedList();
    if (!list.length) { box._chunkToken = null; box.innerHTML = '<div class="cx-empty" style="grid-column:1/-1">还没有忍者，快去召唤吧！</div>'; return; }
    U.chunked(box, list, function (x) {
      var b = U.h('<button class="tm-it" data-id="' + U.esc(x.id) + '">' + U.avatarHTML(x.c, { size: 82, lv: (x.e && x.e.lv) || 1, lazy: true }) + '<div class="nm">' + U.esc(U.charName(x.c)) + '</div><div class="fm">' + U.esc(x.c.form || x.c.title || '') + '</div></button>');
      b.addEventListener('click', function () {
        var cur = team(), i = cur.indexOf(x.id);
        if (i >= 0) cur.splice(i, 1);
        else { if (cur.length >= 5) { U.toast('最多上阵5名忍者，请先点击上方下阵', 'err'); return; } cur.push(x.id); }
        setTeam(cur); renderTeam(el); syncList(el);
      });
      TM.items[x.id] = b; return b;
    }, { size: 22, done: function () { syncList(el); } });
    syncList(el);
  }
  function syncList(el) {
    var t = team();
    Object.keys(TM.items).forEach(function (id) { TM.items[id].classList.toggle('in', t.indexOf(id) >= 0); });
  }
})();
