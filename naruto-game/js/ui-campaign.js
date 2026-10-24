/* 忍界传说 · ui-campaign.js — 冒险推图: chapter list, stage path map with stars, enemy preview, 挑战. */
(function () {
  'use strict';
  var NG = window.NG, U = NG.ui;
  var C = { ch: null, stage: null };

  function chapters() { var l = U.call('chapters'); return Array.isArray(l) ? l.filter(function (c) { return c && Array.isArray(c.stages); }) : []; }
  function sstate(id) { return U.call('stageState', id) || { unlocked: false, stars: 0 }; }
  function chState(ch) {
    var stars = 0, max = ch.stages.length * 3, unlocked = ch.stages.length ? !!sstate(ch.stages[0].id).unlocked : false, cleared = 0;
    ch.stages.forEach(function (s) { var t = sstate(s.id); stars += t.stars || 0; if (t.stars) cleared++; });
    return { stars: stars, max: max, unlocked: unlocked, cleared: cleared, done: cleared === ch.stages.length };
  }
  function frontier() {
    var chs = chapters(), last = null;
    for (var i = 0; i < chs.length; i++) for (var j = 0; j < chs[i].stages.length; j++) {
      var s = chs[i].stages[j], t = sstate(s.id);
      if (t.unlocked) last = { ch: chs[i].id, stage: s.id };
      if (t.unlocked && !t.stars) return { ch: chs[i].id, stage: s.id };
    }
    return last || (chs[0] ? { ch: chs[0].id, stage: chs[0].stages[0] && chs[0].stages[0].id } : { ch: null, stage: null });
  }
  U.campaignFrontier = frontier;
  U.nextStageId = function (sid) {
    var all = []; chapters().forEach(function (c) { c.stages.forEach(function (s) { all.push(s.id); }); });
    var i = all.indexOf(sid); return i >= 0 && i < all.length - 1 ? all[i + 1] : null;
  };
  U.chapterOf = function (sid) { var r = null; chapters().forEach(function (c) { c.stages.forEach(function (s) { if (s.id === sid) r = c; }); }); return r; };

  U.screen('campaign', {
    title: '冒险', particles: 'ember',
    bg: function () { var ch = curCh(); return (ch && ch.bg) || 'forest'; },
    build: function (el) {
      el.innerHTML = '<div class="cp-chs"></div>' +
        '<div class="cp-map"><div class="mbg"><img alt=""></div><svg class="cp-path" viewBox="0 0 600 636"></svg><div class="mt"><div class="t"></div><div class="d"></div></div><div class="nodes"></div></div>' +
        '<div class="cp-info panel"></div>';
      U.scroller(U.$('.cp-chs', el));
    },
    show: function (el, params) {
      var fr = frontier();
      if (params && params.stage) { var c = U.chapterOf(params.stage); if (c) { C.ch = c.id; C.stage = params.stage; } }
      if (!C.ch || !chapters().some(function (c) { return c.id === C.ch; })) { C.ch = fr.ch; C.stage = fr.stage; }
      renderChs(el); renderMap(el); renderInfo(el);
    },
    onChange: function () { renderChs(this.el); renderMap(this.el); renderInfo(this.el); }
  });
  function curCh() { var l = chapters(); for (var i = 0; i < l.length; i++) if (l[i].id === C.ch) return l[i]; return l[0] || null; }

  function renderChs(el) {
    var box = U.$('.cp-chs', el), chs = chapters(), html = '';
    chs.forEach(function (ch, i) {
      var s = chState(ch);
      html += '<button class="cp-ch' + (ch.id === C.ch ? ' on' : '') + (s.unlocked ? '' : ' lock') + '" data-id="' + U.esc(ch.id) + '"><div class="th"><img src="' + U.bgURL(ch.bg || 'forest') + '" alt=""></div>' +
        '<div class="tx"><div class="n">第' + (i + 1) + '章</div><div class="t">' + U.esc(ch.name || '') + '</div><div class="s"><img src="' + U.iconURL('starOn') + '" alt="">' + s.stars + '/' + s.max + (s.done ? '　<span style="color:#7dff9a">已通关</span>' : '') + '</div></div>' +
        (s.unlocked ? '' : '<img class="lk" src="' + U.iconURL('lock') + '" alt="">') + '</button>';
    });
    var st = box.scrollTop; box.innerHTML = html; box.scrollTop = st;
    U.$$('.cp-ch', box).forEach(function (b) {
      b.addEventListener('click', function () {
        var ch = chapters().filter(function (c) { return c.id === b.getAttribute('data-id'); })[0]; if (!ch) return;
        if (!chState(ch).unlocked) { U.toast('通关上一章节后解锁', 'err'); return; }
        C.ch = ch.id; var fr = frontier(); C.stage = fr.ch === ch.id ? fr.stage : (ch.stages[ch.stages.length - 1] || {}).id;
        U.setBg(ch.bg || 'forest'); renderChs(el); renderMap(el); renderInfo(el);
      });
    });
    var on = U.$('.cp-ch.on', box);
    if (on && (on.offsetTop < box.scrollTop || on.offsetTop + 100 > box.scrollTop + box.clientHeight)) box.scrollTop = Math.max(0, on.offsetTop - 120);
  }
  function nodePos(n) {
    var per = n <= 8 ? 4 : n <= 12 ? 4 : 5, rows = Math.ceil(n / per), pts = [];
    var y0 = 205, y1 = 560, x0 = 85, x1 = 515;
    for (var i = 0; i < n; i++) {
      var r = Math.floor(i / per), k = i % per, cnt = Math.min(per, n - r * per);
      var fx = per > 1 ? k / (per - 1) : .5; if (r % 2 === 1) fx = 1 - fx;
      if (cnt < per && r % 2 === 0) fx = fx * (cnt - 1) / (per - 1);
      if (cnt < per && r % 2 === 1) fx = 1 - (k / (per - 1));
      var y = rows > 1 ? y0 + (y1 - y0) * r / (rows - 1) : (y0 + y1) / 2;
      y += [0, -22, 14, -10, 20][i % 5];
      pts.push({ x: x0 + (x1 - x0) * fx, y: y });
    }
    return pts;
  }
  function renderMap(el) {
    var ch = curCh(), map = U.$('.cp-map', el); if (!ch) { U.$('.mt .t', map).textContent = '暂无章节'; return; }
    var idx = chapters().indexOf(ch);
    // same 1280×720 scene URL as the full-screen background (object-fit:cover crops it): one SVG parse, not two
    var mb = U.$('.mbg img', map), mu = U.bgURL(ch.bg || 'forest'); if (mb.getAttribute('src') !== mu) mb.src = mu;
    var ttl = '第' + (idx + 1) + '章 · ' + (ch.name || ''), te = U.$('.mt .t', map);
    te.textContent = ttl; te.className = 't' + (ttl.length > 15 ? ' xlong' : ttl.length > 11 ? ' long' : '');
    U.$('.mt .d', map).textContent = ch.desc || '';
    var pts = nodePos(ch.stages.length), path = '', done = '';
    pts.forEach(function (p, i) {
      if (!i) return; var a = pts[i - 1], mx = (a.x + p.x) / 2, my = (a.y + p.y) / 2 - 18;
      var seg = 'M' + a.x + ' ' + a.y + ' Q' + mx + ' ' + my + ' ' + p.x + ' ' + p.y + ' ';
      path += seg; if (sstate(ch.stages[i - 1].id).stars && sstate(ch.stages[i].id).unlocked) done += seg;
    });
    U.$('.cp-path', map).innerHTML = '<path d="' + path + '" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="10" stroke-linecap="round"/><path d="' + path + '" fill="none" stroke="rgba(220,235,255,.55)" stroke-width="4" stroke-dasharray="2 12" stroke-linecap="round"/>' +
      (done ? '<path d="' + done + '" fill="none" stroke="#ffd25a" stroke-width="5" stroke-dasharray="2 12" stroke-linecap="round" style="filter:drop-shadow(0 0 4px #ffb300)"/>' : '');
    var fr = frontier(), html = '';
    ch.stages.forEach(function (s, i) {
      var t = sstate(s.id), boss = (s.enemies || []).some(function (e) { return e.boss; }) || i === ch.stages.length - 1, p = pts[i];
      html += '<button class="cp-node' + (boss ? ' boss' : '') + (t.unlocked ? '' : ' lock') + (s.id === fr.stage && !t.stars ? ' front' : '') + (s.id === C.stage ? ' sel' : '') + '" data-id="' + U.esc(s.id) + '" style="left:' + p.x + 'px;top:' + p.y + 'px">' +
        (boss ? '<span class="bt">BOSS</span>' : '') + '<div class="md">' + (t.unlocked ? (idx + 1) + '-' + (i + 1) : '<img src="' + U.iconURL('lock') + '" alt="">') + '</div>' +
        '<div class="ss">' + (t.unlocked ? U.starsHTML(t.stars || 0, 3, 19) : '') + '</div></button>';
    });
    var nodes = U.$('.nodes', map); nodes.innerHTML = html;
    U.$$('.cp-node', nodes).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-id');
        if (!sstate(id).unlocked) { U.toast('请先通关前置关卡', 'err'); return; }
        C.stage = id; renderMap(el); renderInfo(el);
      });
    });
  }
  function renderInfo(el) {
    var box = U.$('.cp-info', el), ch = curCh();
    var s = C.stage && U.call('stage', C.stage);
    if (!s || !ch) { box.innerHTML = '<div class="h">冒险</div><div class="t">请选择关卡</div>'; return; }
    var t = sstate(s.id), idx = chapters().indexOf(ch), si = ch.stages.map(function (x) { return x.id; }).indexOf(s.id);
    var my = U.call('teamPower') || 0, rec = s.power || 0;
    var en = (s.enemies || []).filter(function (e) { return U.char(e.id); });
    var rw = '', first = !t.stars && s.firstRewards, src = first ? s.firstRewards : (s.rewards || {});
    ['coins', 'gems', 'tickets', 'scrolls', 'exp'].forEach(function (k) { if (src[k] > 0) rw += U.rewardHTML(k, src[k], !!first); });
    box.innerHTML = '<div class="h">第' + (idx + 1) + '章 · 第' + (si + 1) + '关' + (s.boss ? ' · <span style="color:#ff8a6a">首领战</span>' : '') + '</div><div class="t">' + U.esc(s.name || s.id) + '</div>' +
      (s.desc ? '<div class="dsc">' + U.esc(s.desc) + '</div>' : '') +
      '<div style="margin-top:6px">' + U.starsHTML(t.stars || 0, 3, 26) + '</div>' +
      '<div class="cp-pw"><div><span>推荐战力</span><b class="num">' + U.fmt(rec) + '</b></div><div><span>我的战力</span><b class="num ' + (my >= rec ? 'ok' : 'bad') + '">' + U.fmt(my) + '</b></div></div>' +
      '<div class="sec">敌方阵容</div><div class="cp-en">' + en.map(function (e) {
        var c = U.char(e.id); return '<div class="e' + (e.boss ? ' boss' : '') + '">' + (e.boss ? '<span class="bt">BOSS</span>' : '') + U.avatarHTML(c, { size: 58, lv: e.lv }) + '</div>';
      }).join('') + '</div>' +
      '<div class="sec">' + (first ? '首通奖励' : '通关奖励') + '</div><div class="cp-rw">' + rw + '</div>' +
      '<div class="go"><button class="btn dark" data-a="team">编队</button><button class="btn red lg shine" data-a="fight">挑 战</button></div>';
    U.$$('.cp-en .e', box).forEach(function (d, i) { d.addEventListener('click', function () { U.codexDetail && U.codexDetail(en[i].id); }); });
    U.$('[data-a="team"]', box).addEventListener('click', function () { U.go('team'); });
    U.$('[data-a="fight"]', box).addEventListener('click', function () { U.startBattle(s.id); });
  }
  U.startBattle = function (sid) {
    var t = sstate(sid);
    if (!t.unlocked) { U.toast('关卡尚未解锁', 'err'); return false; }
    var team = (U.state().team || []).filter(function (id) { return U.owned(id); });
    if (!team.length) { U.toast('请先编队上阵忍者', 'err'); U.go('team'); return false; }
    U.go('battle', { stage: sid, t: Date.now() });
    return true;
  };
})();
