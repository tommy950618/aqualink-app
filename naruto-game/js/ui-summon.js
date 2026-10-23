/* 忍界传说 · ui-summon.js — 召唤 (banner, 单抽/十连/百连, card-flip reveal, UR showcase, 100-pull summary). */
(function () {
  'use strict';
  var NG = window.NG, U = NG.ui;
  var bannerTimer = 0, bannerIdx = 0, busy = false;

  function urPool() {
    var l = U.chars().filter(function (c) { return c.rarity === 'UR'; });
    return l.length ? l : U.chars().filter(function (c) { return c.rarity === 'SSR'; }).slice(0, 8);
  }
  function costHTML(n) {
    var st = U.state(), t = st.tickets || 0;
    if (t >= n) return '<span class="cost"><img src="' + U.iconURL('ticket') + '" alt="">×' + n + '</span>';
    var gems = (n - t) * 150;
    return '<span class="cost">' + (t > 0 ? '<img src="' + U.iconURL('ticket') + '" alt="">×' + t + ' + ' : '') + '<img src="' + U.iconURL('gem') + '" alt="">×' + U.fmt(gems) + '</span>';
  }

  U.screen('summon', {
    title: '召唤', bg: 'summon', particles: 'gold', cur: ['tickets', 'gems', 'coins'],
    build: function (el) {
      el.innerHTML =
        '<div class="sm-banner gframe">' + U.cornersHTML() + '<div class="bn-bg"><div class="bn-rays"></div></div><div class="bn-art"></div>' +
        '<div class="bn-txt"><div class="t1">限定招募 · 忍界降临</div><div class="t2 gold-text">六道降临</div><div class="t3">' + U.rarHTML('UR') + '<span>出现概率 <b class="ur-rate">1.5%</b> · 90抽必出</span></div></div>' +
        '<div class="bn-who"><div class="nm"></div><div class="fm"></div><div class="dots"></div></div></div>' +
        '<div class="sm-side panel">' +
        '<div class="sm-tk"><img src="' + U.iconURL('ticket') + '" alt=""><div><div class="v num tk-v">0</div><div class="k">剩余招募券</div></div></div>' +
        '<div class="sm-pity"><div class="tx">再招募 <b class="pity-n">90</b> 次必得 ' + U.rarHTML('UR') + '</div><div class="bar"><i></i></div></div>' +
        '<div class="sm-rates"></div>' +
        '<div class="muted" style="font-size:14px;line-height:1.6">· 十连必出SSR及以上忍者<br>· 重复获得的忍者转化为升星碎片<br>· 抽到不满意？随时可以重新开局！</div>' +
        '<div class="sm-links"><button class="btn dark sm" data-act="rates">概率详情</button><button class="btn red sm" data-act="reset">重新开局</button></div></div>' +
        '<div class="sm-btns">' +
        '<button class="btn blue sm-btn" data-n="1"><span class="t">单 抽</span><span class="c"></span></button>' +
        '<button class="btn sm-btn shine" data-n="10"><span class="tag">必出SSR</span><span class="t">十 连</span><span class="c"></span></button>' +
        '<button class="btn red sm-btn shine" data-n="100"><span class="tag">一键百连</span><span class="t">百 连</span><span class="c"></span></button></div>';
      U.$$('.sm-btn', el).forEach(function (b) { b.addEventListener('click', function () { doSummon(Number(b.getAttribute('data-n'))); }); });
      U.$('[data-act="rates"]', el).addEventListener('click', ratesModal);
      U.$('[data-act="reset"]', el).addEventListener('click', U.resetFlow);
      var art = U.$('.bn-art', el), pool = urPool();
      art.innerHTML = pool.map(function (c, i) { return '<img data-i="' + i + '" alt="">'; }).join('');
      U.$('.dots', el).innerHTML = pool.map(function () { return '<i></i>'; }).join('');
      U.$('.sm-banner', el).addEventListener('click', function () { setBanner(el, bannerIdx + 1); restartBanner(el); });
    },
    show: function (el) {
      upd(el);
      setBanner(el, bannerIdx);
      restartBanner(el);
    },
    leave: function () { clearInterval(bannerTimer); },
    onChange: function () { upd(this.el); }
  });
  function restartBanner(el) { clearInterval(bannerTimer); bannerTimer = setInterval(function () { setBanner(el, bannerIdx + 1); }, 3600); }
  function setBanner(el, i) {
    var pool = urPool(); if (!pool.length) return;
    i = ((i % pool.length) + pool.length) % pool.length;
    var imgs = U.$$('.bn-art img', el);
    imgs.forEach(function (im, k) {
      if (k === i) { if (!im.src) im.src = U.bustURL(pool[k]); im.classList.remove('out'); im.classList.add('on'); }
      else if (im.classList.contains('on')) { im.classList.remove('on'); im.classList.add('out'); }
      else im.classList.remove('out');
    });
    var nx = imgs[(i + 1) % imgs.length]; if (nx && !nx.src) nx.src = U.bustURL(pool[(i + 1) % pool.length]);
    var c = pool[i];
    U.$('.bn-who .nm', el).innerHTML = U.rarHTML(c.rarity) + U.esc(U.charName(c));
    U.$('.bn-who .fm', el).textContent = (c.form ? c.form + ' · ' : '') + (c.title || '');
    U.$$('.bn-who .dots i', el).forEach(function (d, k) { d.classList.toggle('on', k === i); });
    bannerIdx = i;
  }
  function upd(el) {
    var st = U.state();
    U.$('.tk-v', el).textContent = U.fmt(st.tickets || 0);
    var p = U.call('pityInfo') || {}, cap = p.urPity || 90, n = Math.max(0, cap - (p.ur || 0));
    U.$('.pity-n', el).textContent = n;
    U.$('.sm-pity .bar i', el).style.width = U.clamp((p.ur || 0) / cap, 0, 1) * 100 + '%';
    var rates = U.call('rates') || {};
    U.$('.sm-rates', el).innerHTML = ['UR', 'SSR', 'SR', 'R'].map(function (r) {
      var v = rates[r] != null ? rates[r] : (NG.RARITIES[r] || {}).rate;
      return '<div>' + U.rarHTML(r) + '<span>' + U.pct(v) + '</span></div>';
    }).join('');
    U.$('.ur-rate', el).textContent = U.pct(rates.UR != null ? rates.UR : 0.015);
    U.$$('.sm-btn', el).forEach(function (b) { U.$('.c', b).innerHTML = costHTML(Number(b.getAttribute('data-n'))); });
  }
  function ratesModal() {
    var rates = U.call('rates') || {}, html = '<div style="width:760px">';
    html += '<div class="sm-rates" style="margin-bottom:14px">' + ['UR', 'SSR', 'SR', 'R'].map(function (r) {
      var v = rates[r] != null ? rates[r] : (NG.RARITIES[r] || {}).rate; var cnt = U.chars().filter(function (c) { return c.rarity === r; }).length;
      return '<div>' + U.rarHTML(r) + '<span>' + U.pct(v) + '</span><span class="muted" style="font-size:13px">' + cnt + '名忍者</span></div>';
    }).join('') + '</div>';
    html += '<div style="font-size:16px;color:#cfe0ff;line-height:1.8">· 每次十连必定获得至少1名SSR及以上忍者<br>· 距离上次获得UR满90抽时，必定获得UR忍者<br>· 招募券不足时，每抽消耗150勾玉<br>· 重复获得忍者时转化为对应稀有度的升星碎片</div>';
    html += '<div style="margin-top:12px;font-weight:900;color:#ffe9a6">UR 忍者一览</div><div class="scroller ur-list" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;max-height:220px">' +
      urPool().map(function (c) { return '<div style="display:flex;flex-direction:column;align-items:center;width:84px">' + U.avatarHTML(c, { size: 66 }) + '<div style="font-size:12px;margin-top:4px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:84px">' + U.esc(U.charName(c)) + '</div></div>'; }).join('') + '</div></div>';
    var m = U.modal({ title: '概率详情', html: html, buttons: [{ html: '关闭', cls: 'blue' }] });
    var l = U.$('.ur-list', m.el); if (l) U.scroller(l);
  }

  /* ---------------- summon & reveal ---------------- */
  function doSummon(n) {
    if (busy) return;
    var r = U.call('summon', n);
    if (!r || !r.ok || !Array.isArray(r.results)) { U.fail(r, '招募券和勾玉不足'); return; }
    var res = r.results.filter(function (x) { return x && U.char(x.id); });
    if (!res.length) { U.toast('招募失败', 'err'); return; }
    busy = true;
    (n >= 100 || res.length > 10 ? reveal100(res, n) : revealCards(res, n)).then(function () { busy = false; }, function (e) { busy = false; console.error(e); });
  }
  U.doSummon = doSummon;

  function overlay(cls) {
    var ov = U.h('<div class="rv ' + (cls || '') + '"><div class="rv-rays"></div></div>');
    U.$('#fx').appendChild(ov);
    return ov;
  }
  function sleep(ms, ctl) {
    return new Promise(function (res) {
      if (ctl && ctl.skip) return res();
      var t = setTimeout(res, ms);
      if (ctl) ctl.wake = function () { clearTimeout(t); res(); };
    });
  }
  function rOrder(r) { return (NG.RARITIES[r] || {}).order || 0; }

  function cardHTML(x) {
    var c = U.char(x.id), r = U.rarity(c);
    return '<div class="rv-slot r-' + r + '" style="--rc:' + U.rcolor(c) + '"><div class="glow"></div><div class="rv-card r-' + r + '">' +
      '<div class="face back"><img src="' + U.iconURL('leaf') + '" alt=""></div>' +
      '<div class="face front"><div class="art"><img src="' + U.avatarURL(c, 256) + '" alt=""></div>' + U.rarHTML(r) +
      (x.isNew ? '' : '<span class="shard">碎片+' + (x.shards || 0) + '</span>') +
      '<div class="info"><div class="nm">' + U.esc(U.charName(c)) + '</div><div class="fm">' + U.esc(U.charForm(c)) + '</div></div>' +
      (x.isNew ? '<span class="newb hidden">NEW</span>' : '') + '</div></div></div>';
  }

  function revealCards(res, n) {
    return new Promise(function (done) {
      var hasUR = res.some(function (x) { return x.rarity === 'UR' || U.rarity(U.char(x.id)) === 'UR'; });
      var ov = overlay(hasUR ? 'has-ur' : '');
      ov.insertAdjacentHTML('beforeend', '<div class="rv-head">招募结果</div><div class="rv-grid ' + (res.length === 1 ? 'n1' : 'n10') + '"></div><button class="btn dark sm rv-skip">跳过</button><div class="rv-bar hidden"></div>');
      var grid = U.$('.rv-grid', ov), ctl = { skip: false, multi: res.length > 1 };
      res.forEach(function (x, i) { var c = U.h(cardHTML(x)); c.style.animationDelay = (i * 0.06) + 's'; grid.appendChild(c); });
      var cards = U.$$('.rv-slot', grid);
      U.$('.rv-skip', ov).addEventListener('click', function () { ctl.skip = true; if (ctl.wake) ctl.wake(); if (ctl.closeShow) ctl.closeShow(); });
      ov.addEventListener('click', function (e) { if (!e.target.closest('button') && ctl.wake) ctl.wake(); });
      (async function () {
        await sleep(450 + res.length * 60, ctl);
        for (var i = 0; i < cards.length; i++) {
          var x = res[i], r = U.rarity(U.char(x.id)), card = cards[i];
          if (!ctl.skip && (r === 'UR' || r === 'SSR')) { card.firstElementChild.nextElementSibling.classList.add('tease-' + r); await sleep(r === 'UR' ? 700 : 380, ctl); card.firstElementChild.nextElementSibling.classList.remove('tease-' + r); }
          flip(card);
          if (!ctl.skip && r === 'UR') { await sleep(380, ctl); await showcase(x, ctl); }
          else if (!ctl.skip && r === 'SSR' && res.length === 1) { await sleep(380, ctl); await showcase(x, ctl); }
          else await sleep(ctl.skip ? 0 : (res.length === 1 ? 300 : 170), ctl);
        }
        if (ctl.skip) cards.forEach(flip);
        U.$('.rv-skip', ov).classList.add('hidden');
        finishBar(ov, n, done);
      })();
    });
  }
  function flip(card) {
    if (card.classList.contains('flip')) return;
    card.classList.add('flip');
    var inner = U.$('.rv-card', card); if (inner) inner.classList.add('flip');
    var nb = U.$('.newb', card); if (nb) setTimeout(function () { nb.classList.remove('hidden'); }, 300);
  }
  function finishBar(ov, n, done) {
    var bar = U.$('.rv-bar', ov); bar.classList.remove('hidden');
    var again = n >= 100 ? 100 : n;
    bar.innerHTML = '<button class="btn dark lg" data-a="ok">确 定</button><button class="btn ' + (again >= 100 ? 'red' : again >= 10 ? '' : 'blue') + ' lg shine" data-a="again"><span>再来' + (again === 1 ? '一抽' : again + '连') + '</span>' + costHTML(again) + '</button>';
    U.$('[data-a="ok"]', bar).addEventListener('click', function () { close(ov); done(); });
    U.$('[data-a="again"]', bar).addEventListener('click', function () {
      var st = U.state(); if ((st.tickets || 0) < again && (st.gems || 0) < (again - (st.tickets || 0)) * 150) { U.toast('招募券和勾玉不足', 'err'); return; }
      close(ov); done(); setTimeout(function () { doSummon(again); }, 120);
    });
  }
  function close(ov) { ov.style.transition = 'opacity .2s'; ov.style.opacity = '0'; setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 220); }

  /* full screen UR / SSR showcase. resolves on tap or after a few seconds */
  function showcase(x, ctl) {
    return new Promise(function (res) {
      var c = U.char(x.id); if (!c) return res();
      var r = U.rarity(c);
      var sh = U.h('<div class="ur-show r-' + r + '"><div class="rays"></div><div class="ring"></div><div class="ring r2"></div>' +
        '<img class="bust" src="' + U.bustURL(c) + '" alt="">' +
        '<div class="big">' + U.rarHTML(r) + '</div>' +
        '<div class="who"><div class="nm">' + U.esc(U.charName(c)) + (x.isNew ? '<span class="newb">NEW</span>' : '') + '</div><div class="en">' + U.esc(c.en || '') + '</div>' +
        '<div class="fm">' + U.esc(U.charForm(c) || '') + '</div><div class="qt">' + U.esc(c.quote ? '「' + c.quote + '」' : '') + '</div></div>' +
        '<div class="flash"></div><div class="rv-tap">点击继续</div>' + (ctl.multi ? '<button class="btn dark sm rv-skip">跳过</button>' : '') + '</div>');
      U.$('.big .rar', sh).style.fontSize = '190px';
      U.$('#fx').appendChild(sh);
      var t0 = performance.now(), closed = false;
      function end() { if (closed) return; closed = true; ctl.closeShow = null; sh.style.transition = 'opacity .25s'; sh.style.opacity = '0'; setTimeout(function () { if (sh.parentNode) sh.parentNode.removeChild(sh); res(); }, 250); }
      ctl.closeShow = end;
      var sk = U.$('.rv-skip', sh);
      if (sk) sk.addEventListener('click', function (e) { e.stopPropagation(); ctl.skip = true; if (ctl.wake) ctl.wake(); end(); });
      sh.addEventListener('click', function () { if (performance.now() - t0 > 500) end(); });
      setTimeout(end, 3400);
    });
  }

  function reveal100(res, n) {
    return new Promise(function (done) {
      var urs = res.filter(function (x) { return U.rarity(U.char(x.id)) === 'UR'; });
      var ov = overlay(urs.length ? 'has-ur' : ''), ctl = { skip: false, multi: true };
      ov.insertAdjacentHTML('beforeend', '<div class="bt-vs gold-text" style="animation-duration:1.1s">百连招募</div><button class="btn dark sm rv-skip">跳过</button><div class="rv-bar hidden"></div>');
      U.$('.rv-skip', ov).addEventListener('click', function () { ctl.skip = true; if (ctl.wake) ctl.wake(); if (ctl.closeShow) ctl.closeShow(); });
      (async function () {
        await sleep(950, ctl);
        for (var i = 0; i < urs.length && !ctl.skip; i++) await showcase(urs[i], ctl);
        U.$('.rv-skip', ov).classList.add('hidden');
        var vs = U.$('.bt-vs', ov); if (vs) vs.remove();
        var sorted = res.slice().sort(function (a, b) {
          var ca = U.char(a.id), cb = U.char(b.id);
          return (rOrder(U.rarity(cb)) - rOrder(U.rarity(ca))) || ((b.isNew ? 1 : 0) - (a.isNew ? 1 : 0));
        });
        var cnt = { UR: 0, SSR: 0, SR: 0, R: 0 }, nw = 0;
        sorted.forEach(function (x) { cnt[U.rarity(U.char(x.id))]++; if (x.isNew) nw++; });
        var sum = U.h('<div class="rv-sum gframe">' + U.cornersHTML() + '<div class="modal-title">百连结果</div>' +
          '<div class="stat">' + ['UR', 'SSR', 'SR', 'R'].map(function (r) { return '<span>' + U.rarHTML(r) + '×' + cnt[r] + '</span>'; }).join('') + '<span style="color:#ff9b7a">新忍者 ×' + nw + '</span></div><div class="grid"></div></div>');
        var grid = U.$('.grid', sum), html = '';
        sorted.forEach(function (x, i) {
          var c = U.char(x.id), r = U.rarity(c);
          html += '<div class="mini r-' + r + '" style="--rc:' + U.rcolor(c) + ';animation-delay:' + (i * 0.012).toFixed(3) + 's"><div class="mi"><img src="' + U.avatarURL(c, 128) + '" alt=""></div>' + U.rarHTML(r) + (x.isNew ? '<span class="newb">NEW</span>' : '') + '</div>';
        });
        grid.innerHTML = html;
        ov.appendChild(sum);
        U.$$('.mini', grid).forEach(function (m, i) { m.addEventListener('click', function () { var x = sorted[i]; var c = U.char(x.id); if (c) U.toast(U.charName(c) + (c.form ? '·' + c.form : '') + (x.isNew ? '（新）' : '（碎片+' + (x.shards || 0) + '）')); }); });
        finishBar(ov, 100, done);
        U.$('.rv-bar', ov).style.bottom = '16px';
      })();
    });
  }
})();
