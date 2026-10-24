/* DEV ONLY — end-to-end QA pass that plays 忍界传说 like a player in one viewport and audits it.
 *   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
 *     node tools/_qa.js <desktop|portrait|landscape|ipad> [outDir]
 * Needs a static server on BASE (default http://localhost:8133/index.html), e.g.
 *   npx http-server . -p 8133 -s -c-1
 * Flow: first launch → welcome → 百连 ×10 (all 1000 tickets; natural + skipped reveals) → 十连/单抽 incl. double-tap spam →
 * training (lv ×1/×10/max, star up, skill popup + upgrade, arrows / swipe / list) → team (remove all, battle attempt,
 * manual + auto) → campaign (first ~15 stages: ×4 and 跳过, next-stage flow, stars, deliberate loss, retreat mid-fight,
 * 挑战 double-tap) → codex (every filter, detail popups, scroll) → AFK chest → settings (rotate, speed) → reload
 * (persistence) → reset (wipe + welcome). Audits along the way: console/page errors, unhandled rejections, currency
 * pills vs state, tap targets < 44px, text overflow / off-stage text, placeholder text, battle formation & z-order,
 * timer / rAF leaks after leaving battle, DOM + heap growth over many battles, external requests, alert/confirm/open. */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const VP = process.argv[2] || 'desktop';
const OUT = path.join(process.argv[3] || '/tmp/claude-0/-home-user-aqualink-app/7b37f5eb-8962-565a-b27d-4cf648e4c413/scratchpad/qa', VP);
const BASE = process.env.BASE || 'http://localhost:8133/index.html';
const ORIGIN = new URL(BASE).origin;
const FULL = process.env.QUICK ? false : true;
const VPS = {
  desktop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  portrait: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  landscape: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ipad: { viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
};
fs.mkdirSync(OUT, { recursive: true });
fs.readdirSync(OUT).filter((f) => /\.png$/.test(f)).forEach((f) => fs.unlinkSync(path.join(OUT, f)));

const errors = [], warns = [], notes = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${VP}]`, ...a);
function fail(msg) { errors.push(msg); console.log(`[${VP}] FAIL ${msg}`); }
function warn(msg) { warns.push(msg); console.log(`[${VP}] warn ${msg}`); }
function note(msg) { notes.push(msg); console.log(`[${VP}] note ${msg}`); }

const INIT = () => {
  const Q = window.__qa = { errs: [], dialogs: [], opens: [], longtasks: [], raf: 0 };
  window.addEventListener('unhandledrejection', (e) => Q.errs.push('unhandledrejection: ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason)));
  window.addEventListener('error', (e) => Q.errs.push('window.error: ' + e.message));
  ['alert', 'confirm', 'prompt'].forEach((k) => { window[k] = function (m) { Q.dialogs.push(k + ':' + m); return k === 'confirm' ? false : null; }; });
  window.open = function (u) { Q.opens.push(String(u)); return null; };
  const st = window.setTimeout, ct = window.clearTimeout, si = window.setInterval, ci = window.clearInterval, ra = window.requestAnimationFrame;
  const tids = new Map(), iids = new Set();
  window.setTimeout = function (fn, ms) {
    const a = Array.prototype.slice.call(arguments, 2), stack = (new Error().stack || '').split('\n').slice(2, 4).join(' | ');
    const id = st(function () { tids.delete(id); if (typeof fn === 'function') fn.apply(this, a); }, ms);
    tids.set(id, { ms: ms || 0, at: performance.now(), stack }); return id;
  };
  window.clearTimeout = function (id) { tids.delete(id); return ct(id); };
  window.setInterval = function (fn, ms) { const id = si.apply(window, arguments); iids.add(id); return id; };
  window.clearInterval = function (id) { iids.delete(id); return ci(id); };
  window.requestAnimationFrame = function (cb) { Q.raf++; return ra.call(window, cb); };
  Q.pending = () => ({ timeouts: tids.size, intervals: iids.size, list: Array.from(tids.values()).map((t) => t.ms + 'ms@' + t.stack) });
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => Q.longtasks.push({ t: e.startTime, d: e.duration }))).observe({ type: 'longtask', buffered: true }); } catch (e) {}
};

(async () => {
  const browser = await chromium.launch({ args: ['--disable-gpu', '--js-flags=--expose-gc'] });
  const conf = VPS[VP];
  const ctx = await browser.newContext(conf);
  const page = await ctx.newPage();
  const touch = !!conf.hasTouch;
  await ctx.addInitScript(INIT);
  page.on('console', (m) => { if (m.type() === 'error') fail('console.error: ' + m.text()); else if (m.type() === 'warning') warn('console.warn: ' + m.text()); });
  page.on('pageerror', (e) => fail('pageerror: ' + e.message + ' ' + (e.stack || '').split('\n').slice(0, 3).join(' | ')));
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith(ORIGIN) || u.startsWith('data:') || u.startsWith('blob:')) return;
    if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u)) return;
    fail('external request: ' + u);
  });
  // fonts: serve empty so runs are deterministic offline (FONTS=net to load the real ones)
  if (process.env.FONTS !== 'net') await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: r.request().url().includes('googleapis') ? 'text/css' : 'font/woff2', body: '' }));
  const cdp = await ctx.newCDPSession(page);

  /* ---------------- helpers ---------------- */
  let shotN = 0;
  const shots = {};
  async function shot(name) { const f = path.join(OUT, String(++shotN).padStart(2, '0') + '_' + name + '.png'); await page.screenshot({ path: f }); shots[name] = f; return f; }
  async function vis(sel) { return page.locator(sel).filter({ visible: true }).count().then((n) => n > 0).catch(() => false); }
  async function tap(sel, o) {
    o = o || {};
    const loc = page.locator(sel).filter({ visible: true }).nth(o.nth || 0);
    await loc.waitFor({ state: 'visible', timeout: o.timeout || 8000 });
    if (touch) await loc.tap({ timeout: o.timeout || 8000, force: !!o.force }); else await loc.click({ timeout: o.timeout || 8000, force: !!o.force });
    await sleep(o.wait == null ? 380 : o.wait);
  }
  async function tryTap(sel, o) { try { await tap(sel, Object.assign({ timeout: 1500 }, o || {})); return true; } catch (e) { return false; } }
  const ev = (fn, arg) => page.evaluate(fn, arg);
  async function S() { return ev(() => { const s = NG.game.state; return { tickets: s.tickets, gems: s.gems, coins: s.coins, scrolls: s.scrolls, roster: Object.keys(s.roster).length, team: s.team.slice(), progress: Object.assign({}, s.progress), pulls: s.totalPulls, welcomed: !!s.flags.welcomed, speed: s.settings.speed, rotate: s.settings.rotate, name: s.player.name }; }); }
  // stage-design coordinates → viewport coordinates (inverse of NG.ui.toStage; handles the rotated stage)
  async function toScreen(x, y) { return ev(([x, y]) => { const v = NG.ui.view, W = 1280, H = 720; if (v.rot) { const dy = x - W / 2, dx = H / 2 - y; return { x: v.cx + dx * v.s, y: v.cy + dy * v.s }; } return { x: v.cx + (x - W / 2) * v.s, y: v.cy + (y - H / 2) * v.s }; }, [x, y]); }
  async function drag(x0, y0, x1, y1, steps) {
    const a = await toScreen(x0, y0), b = await toScreen(x1, y1); steps = steps || 12;
    if (touch) {
      const pt = (p) => [{ x: p.x, y: p.y, id: 1 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(a) });
      for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt({ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }) }); await sleep(16); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(a.x, a.y); await page.mouse.down();
      for (let i = 1; i <= steps; i++) { await page.mouse.move(a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps); await sleep(16); }
      await page.mouse.up();
    }
    await sleep(450);
  }
  async function waitFor(fn, arg, timeout) { return page.waitForFunction(fn, arg, { timeout: timeout || 10000, polling: 100 }); }
  async function nav(name) {           // via the ☰ quick-nav like a player
    if (await ev(() => NG.ui.current()) === name) return;
    if (await vis('.tb-menu') && await ev(() => getComputedStyle(document.querySelector('#topbar .tb-title')).transform === 'none')) {
      await tap('.tb-menu'); await tap('.qnav [data-go="' + name + '"]', { wait: 600 });
    } else if (name !== 'home' && await vis('.scr-home.on [data-go="' + name + '"]')) await tap('.scr-home.on [data-go="' + name + '"]', { wait: 600 });
    else await ev((n) => NG.ui.go(n), name), await sleep(600);
    if (await ev(() => NG.ui.current()) !== name) fail('nav to ' + name + ' failed (at ' + await ev(() => NG.ui.current()) + ')');
  }

  /* ---------------- audits ---------------- */
  async function audit(tag) {
    await sleep(120);
    const r = await ev(() => {
      const out = { small: [], over: [], off: [], bad: [], trunc: [] };
      const v = NG.ui.view, s = v.s;
      const stage = document.getElementById('stage').getBoundingClientRect();
      const visible = (el) => { if (!el.isConnected) return false; const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false; const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; let p = el; while (p && p !== document.body) { const c = getComputedStyle(p); if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0) return false; p = p.parentElement; } return true; };
      const scope = Array.from(document.querySelectorAll('#stage .scr.on, #topbar, #modals .mask:not(.out), #fx > *'));
      // pick the top-most layer: when a modal / overlay is open, only it is interactive
      const top = document.querySelector('#fx > .rv, #fx > .ur-show') ? Array.from(document.querySelectorAll('#fx > .rv, #fx > .ur-show')) : (document.querySelector('#modals .mask:not(.out)') ? Array.from(document.querySelectorAll('#modals .mask:not(.out)')) : scope);
      const name = (el) => (el.className && typeof el.className === 'string' ? el.tagName.toLowerCase() + '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : el.tagName.toLowerCase()) + '「' + (el.textContent || '').trim().slice(0, 14) + '」';
      top.forEach((root) => root.querySelectorAll('button, [data-go], .tap, .cx-card, .tm-it, .cp-node, .mini, .tr-item').forEach((el) => {
        if (!visible(el) || el.closest('.hidden')) return;
        const r = el.getBoundingClientRect();
        const w = (v.rot ? r.height : r.width) / s, h = (v.rot ? r.width : r.height) / s;
        if (w < 43.5 || h < 43.5) out.small.push(name(el) + ' ' + w.toFixed(0) + 'x' + h.toFixed(0));
      }));
      scope.forEach((root) => root.querySelectorAll('*').forEach((el) => {
        if (!el.firstChild || !Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) return;
        if (!visible(el)) return;
        const cs = getComputedStyle(el), txt = el.textContent.trim();
        if (/undefined|NaN|\bnull\b|\[object|function\s*\(|\?\?\?/.test(txt)) out.bad.push(name(el));
        if (/[A-Za-z]{4,}/.test(txt) && !el.closest('.tr-en, .en, .cxd-right .en, .who .en, .boot-sub')) { const w = txt.match(/[A-Za-z]{4,}/g).filter((x) => !/^(BOSS|Lv|NEW|EXP|MVP)$/i.test(x)); if (w.length) out.bad.push('english? ' + name(el)); }
        const r = el.getBoundingClientRect();
        if (r.right > stage.right + 2 || r.left < stage.left - 2 || r.bottom > stage.bottom + 2 || r.top < stage.top - 2) { if (!el.closest('.home-ticker, .bt-fx, .cutin, .dmg, .pills.fac, .scroller, #topbar.home .tb-title')) out.off.push(name(el)); }
        if (el.scrollWidth > el.clientWidth + 2 && cs.overflow !== 'visible') { if (cs.textOverflow === 'ellipsis') out.trunc.push(name(el)); else if (cs.whiteSpace === 'nowrap' && !el.closest('.home-ticker, .scroller')) out.over.push(name(el) + ' sw' + el.scrollWidth + '>cw' + el.clientWidth); }
        else if (cs.overflow === 'visible' && cs.whiteSpace === 'nowrap' && el.parentElement) {
          // nowrap text spilling out of its own (clipping or boxed) parent
          const p = el.parentElement, pr = p.getBoundingClientRect(), pcs = getComputedStyle(p);
          if ((pcs.overflow !== 'visible' || pcs.backgroundImage !== 'none' || pcs.backgroundColor !== 'rgba(0, 0, 0, 0)') && (r.right > pr.right + 3 || r.left < pr.left - 3) && !el.closest('.home-ticker, .dmg, .cutin, .bt-vs, .rv-head, .modal-title, .wtitle')) out.over.push('spill ' + name(el));
        }
      }));
      return out;
    });
    const uniq = (a) => Array.from(new Set(a));
    if (r.small.length) warn(tag + ' tap targets <44: ' + uniq(r.small).slice(0, 12).join(', '));
    if (r.over.length) warn(tag + ' text overflow: ' + uniq(r.over).slice(0, 10).join(', '));
    if (r.off.length) warn(tag + ' text outside stage: ' + uniq(r.off).slice(0, 8).join(', '));
    if (r.bad.length) fail(tag + ' bad/placeholder text: ' + uniq(r.bad).slice(0, 8).join(', '));
    if (r.trunc.length) note(tag + ' truncated (ellipsis): ' + uniq(r.trunc).slice(0, 8).join(', '));
    const q = await ev(() => ({ errs: window.__qa.errs.splice(0), dialogs: window.__qa.dialogs.splice(0), opens: window.__qa.opens.splice(0) }));
    q.errs.forEach((e) => fail(tag + ' ' + e)); q.dialogs.forEach((e) => fail(tag + ' native dialog used: ' + e)); q.opens.forEach((e) => fail(tag + ' window.open: ' + e));
    // the document itself must never scroll
    const sc = await ev(() => [window.scrollX, window.scrollY, document.documentElement.scrollTop, document.body.scrollTop, document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight]);
    if (sc[0] || sc[1] || sc[2] || sc[3]) fail(tag + ' page scrolled ' + sc.join(','));
  }
  async function checkCur(tag) {
    await sleep(80);
    const r = await ev(() => Array.from(document.querySelectorAll('#topbar .cur')).filter((el) => el.offsetParent).map((el) => { const k = el.getAttribute('data-k'); return [k, el.querySelector('.cur-v').textContent, NG.fmt(Number(NG.game.state[k]) || 0)]; }));
    r.forEach(([k, a, b]) => { if (a !== b) fail(tag + ' currency pill ' + k + ' shows ' + a + ' but state is ' + b); });
  }
  async function battleAudit(tag) {
    const r = await ev(() => {
      const us = Array.from(document.querySelectorAll('.scr-battle .bt-unit')).map((el) => ({ el, side: el.classList.contains('B') ? 'B' : 'A', x: parseFloat(el.style.left), y: parseFloat(el.style.top), z: +el.style.zIndex, n: el.querySelector('.n').textContent }));
      const out = { mixed: [], cover: [], fxz: null };
      us.forEach((u) => { if ((u.side === 'A' && u.x >= 600) || (u.side === 'B' && u.x <= 680)) out.mixed.push(u.side + ':' + u.n + '@' + u.x); });
      const minA = Math.min(...us.filter((u) => u.side === 'B').map((u) => u.x)) - Math.max(...us.filter((u) => u.side === 'A').map((u) => u.x));
      out.gap = minA;
      // a unit's HP bar must not sit under another unit's body (design coords, before any lunge)
      us.forEach((a) => us.forEach((b) => {
        if (a === b) return;
        const hud = { l: a.x - 76, r: a.x + 76, t: a.y + 10, b: a.y + 30 }, body = { l: b.x - 70, r: b.x + 70, t: b.y - 150, b: b.y };
        const ov = Math.min(hud.r, body.r) - Math.max(hud.l, body.l), oh = Math.min(hud.b, body.b) - Math.max(hud.t, body.t);
        if (ov > 12 && oh > 4 && b.z >= a.z) out.cover.push(a.n + ' HP under ' + b.n);
      }));
      const fx = document.querySelector('.scr-battle .bt-fx'), un = document.querySelector('.scr-battle .bt-units');
      out.fxz = [getComputedStyle(fx).zIndex, getComputedStyle(un).zIndex];
      return out;
    });
    if (r.mixed.length) fail(tag + ' units on the wrong half: ' + r.mixed.join(', '));
    if (r.cover.length) fail(tag + ' HP bar covered: ' + r.cover.join(', '));
    if (!(+r.fxz[0] > +r.fxz[1])) fail(tag + ' FX layer (z ' + r.fxz[0] + ') not above units (z ' + r.fxz[1] + ')');
    return r;
  }
  async function heap() { await cdp.send('HeapProfiler.collectGarbage'); await sleep(200); await cdp.send('HeapProfiler.collectGarbage'); const h = await cdp.send('Runtime.getHeapUsage'); const nodes = await ev(() => document.getElementsByTagName('*').length); return { mb: +(h.usedSize / 1048576).toFixed(1), nodes }; }

  /* ---------------- reveal / battle drivers ---------------- */
  async function finishReveal(mode, tag) {
    let showShot = false;
    for (let i = 0; i < 400; i++) {
      if (await vis('.rv-bar:not(.hidden) [data-a="ok"]')) { await sleep(500); return; }
      if (mode === 'skip') {
        if (await vis('.ur-show .rv-skip')) await tryTap('.ur-show .rv-skip', { wait: 150 });
        else if (await vis('.rv > .rv-skip:not(.hidden)')) await tryTap('.rv > .rv-skip:not(.hidden)', { wait: 150 });
      } else if (await vis('.ur-show')) {
        if (!showShot && tag) { await sleep(1300); await shot(tag + '_showcase'); showShot = true; }
        await sleep(700); await tryTap('.ur-show', { wait: 300, force: true });
      }
      await sleep(120);
    }
    throw new Error('reveal never finished');
  }
  async function summonAndFinish(n, mode, tag) {
    const before = await S();
    await tap('.scr-summon.on .sm-btn[data-n="' + n + '"]', { wait: 250 });
    await finishReveal(mode, tag);
    const after = await S();
    if (after.pulls - before.pulls !== n) fail(`summon ${n}: totalPulls +${after.pulls - before.pulls}`);
    return { before, after };
  }
  async function playBattle(mode, tag) {
    await waitFor(() => NG.ui.current() === 'battle' && document.querySelectorAll('.scr-battle .bt-unit').length > 1, null, 10000);
    await sleep(250);
    const ba = await battleAudit(tag || 'battle');
    let cut = false, mid = false;
    if (mode === 'skip') { await sleep(500); await tap('.scr-battle [data-a="skip"]', { wait: 100 }); }
    else {
      for (let k = 0; k < 3; k++) { const t = await page.textContent('.scr-battle [data-a="speed"]'); if (t.trim() === '×4') break; await tap('.scr-battle [data-a="speed"]', { wait: 120 }); }
    }
    const t0 = Date.now();
    for (;;) {
      if (await vis('#modals .res')) break;
      if (Date.now() - t0 > 150000) throw new Error('battle never ended');
      if (tag && !mid && Date.now() - t0 > 1800 && await page.locator('.bt-fx .dmg').count() >= 2) { await shot(tag + '_mid'); mid = true; }
      if (tag && !cut && await vis('#fx .cutin .sname')) { await sleep(420); await shot(tag + '_cutin'); cut = true; }
      await sleep(cut ? 200 : 60);
    }
    await sleep(1300);
    const res = await ev(() => ({ win: !!document.querySelector('#modals .res.win'), stars: document.querySelectorAll('#modals .res .rstars img.pop').length, next: !!document.querySelector('#modals .res .modal-btns .btn.red') }));
    return Object.assign(res, { gap: ba.gap });
  }

  try {
    /* ======================= first launch ======================= */
    await page.goto(BASE);
    await page.waitForSelector('#boot', { state: 'detached', timeout: 15000 });
    await waitFor(() => document.querySelector('#modals .welcome'), null, 5000);
    await sleep(700);
    const v0 = await ev(() => NG.ui.view);
    log('view', JSON.stringify(v0));
    if ((VP === 'portrait' || VP === 'ipad') !== !!v0.rot) fail('rotation state unexpected: ' + JSON.stringify(v0));
    await shot('welcome'); await audit('welcome');
    // mask tap must not dismiss the welcome
    await tryTap('#modals .mask', { force: true, wait: 300 });
    if (!await vis('#modals .welcome')) fail('welcome dismissed by tapping the mask');
    await tap('.welcome .btn', { wait: 700 });
    if (await ev(() => NG.ui.current()) !== 'summon') fail('welcome did not go to 召唤');
    await shot('summon'); await audit('summon'); await checkCur('summon');

    /* ======================= 百连 ×10 ======================= */
    for (let i = 0; i < 10; i++) {
      const mode = i === 0 ? 'natural' : 'skip';
      const { after } = await summonAndFinish(100, mode, i === 0 ? 'pull100' : null);
      if (i === 0) { await sleep(900); await shot('pull100_summary'); await audit('pull100 summary'); }
      if (after.tickets !== 1000 - 100 * (i + 1)) fail('tickets after 百连 #' + (i + 1) + ' = ' + after.tickets);
      await tap('.rv-bar [data-a="ok"]', { wait: 500 });
      const tk = await page.textContent('.scr-summon .tk-v');
      if (tk.trim() !== await ev(() => NG.fmt(NG.game.state.tickets))) fail('summon ticket counter stale: ' + tk);
      await checkCur('after 百连 ' + (i + 1));
    }
    let s = await S();
    log('after 1000 pulls: roster', s.roster, 'tickets', s.tickets, 'gems', s.gems);
    if (s.tickets !== 0) fail('tickets not 0 after 10×百连: ' + s.tickets);
    if (!(await page.textContent('.scr-summon .sm-btn[data-n="100"] .c')).includes(await ev(() => NG.fmt(15000)))) warn('百连 cost does not switch to 勾玉 when out of tickets');
    await shot('summon_out_of_tickets');

    /* 十连: watch the flips once, then double-tap spam */
    await summonAndFinish(10, 'natural', 'pull10');
    await shot('pull10_result'); await audit('pull10 result');
    await tap('.rv-bar [data-a="ok"]', { wait: 500 });
    s = await S();
    const loc10 = page.locator('.scr-summon.on .sm-btn[data-n="10"]');
    if (touch) { await loc10.tap(); await loc10.tap({ force: true, timeout: 1500 }).catch(() => {}); } else await loc10.dblclick();
    await sleep(300);
    await finishReveal('skip');
    let s2 = await S();
    if (s2.pulls - s.pulls !== 10) fail('double-tap 十连 performed ' + (s2.pulls - s.pulls) + ' pulls');
    // 再来十连 double tap on the result bar must not trigger extra pulls or the 单抽 underneath
    const again = page.locator('.rv-bar [data-a="again"]');
    if (touch) { await again.tap(); await again.tap({ force: true, timeout: 1500 }).catch(() => {}); } else await again.dblclick();
    await sleep(500);
    await finishReveal('skip');
    const s3 = await S();
    if (s3.pulls - s2.pulls !== 10) fail('double-tap 再来十连 performed ' + (s3.pulls - s2.pulls) + ' pulls');
    const okBtn = page.locator('.rv-bar [data-a="ok"]');
    if (touch) { await okBtn.tap(); await okBtn.tap({ force: true, timeout: 1500 }).catch(() => {}); } else await okBtn.dblclick();
    await sleep(800);
    if ((await S()).pulls !== s3.pulls || await vis('#fx .rv')) fail('double-tap 确定 leaked a tap into the summon buttons');
    await summonAndFinish(1, 'natural');
    await tap('.rv-bar [data-a="ok"]', { wait: 500 });
    await checkCur('summon done');
    // rates popup + its scroller, closed with ×
    await tap('.scr-summon [data-act="rates"]', { wait: 500 }); await audit('rates popup'); await tap('.modal-x', { wait: 400 });

    /* ======================= home ======================= */
    await tap('.tb-back', { wait: 700 });
    if (await ev(() => NG.ui.current()) !== 'home') fail('back from summon did not reach home');
    await sleep(600); await shot('home'); await audit('home'); await checkCur('home');
    const homeSub = await ev(() => [document.querySelector('.scr-home .cx-sub').textContent, document.querySelector('.scr-home .sm-sub').textContent]);
    const expOwn = await ev(() => '已收集 ' + NG.game.ownedList().length + '/' + NG.CHARS.length);
    if (homeSub[0] !== expOwn) fail('home codex subtitle stale: ' + homeSub[0] + ' vs ' + expOwn);

    /* ======================= training ======================= */
    await tap('.scr-home [data-go="train"]', { wait: 900 });
    await shot('train'); await audit('train skills');
    const tid = await ev(() => document.querySelector('.scr-train .tr-item .av.sel') && document.querySelector('.scr-train .tr-item .av.sel').closest('.tr-item').getAttribute('data-id'));
    // skill popup + upgrade
    await tap('.scr-train .sk[data-k="s1"]', { wait: 500 }); await shot('train_skill_popup'); await audit('skill popup');
    const sk0 = await ev((id) => NG.game.state.roster[id].skills.s1, tid);
    await tap('.skd [data-a="up"]', { wait: 400 });
    const sk1 = await ev((id) => NG.game.state.roster[id].skills.s1, tid);
    if (sk1 !== sk0 + 1) fail('skill upgrade did not apply (' + sk0 + '→' + sk1 + ')');
    if (!(await page.textContent('.skd .lv')).includes('等级 ' + sk1)) fail('skill popup level not refreshed');
    await tap('.modal-x', { wait: 400 });
    if (!(await page.textContent('.scr-train .sk[data-k="s1"] .sk-lv')).includes(String(sk1))) fail('skill card level not refreshed');
    await tap('.scr-train .sk[data-k="awaken"]', { wait: 400 }); await tap('.modal-x', { wait: 400 });
    // level ×1 / ×10 / max
    await tap('.scr-train .tr-tabbar [data-tab="attr"]', { wait: 400 }); await shot('train_attr'); await audit('train attr');
    const lv0 = await ev((id) => NG.game.state.roster[id].lv, tid);
    await tap('.scr-train .at-btns [data-n="1"]', { wait: 400 });
    await tap('.scr-train .at-btns .btn:nth-child(2)', { wait: 400 });
    const lv1 = await ev((id) => NG.game.state.roster[id].lv, tid);
    if (lv1 !== lv0 + 11) fail('level ×1 + ×10 gave ' + lv0 + '→' + lv1);
    await tap('.scr-train .at-btns [data-n="max"]', { wait: 700 });
    const lv2 = await ev((id) => [NG.game.state.roster[id].lv, NG.game.maxLevel(id)], tid);
    if (lv2[0] !== lv2[1]) fail('一键满级 stopped at ' + lv2[0] + '/' + lv2[1]);
    await checkCur('after level up');
    const pwOk = await ev((id) => document.querySelector('.scr-train .tr-meta .pw').textContent.includes(NG.fmt(NG.game.power(id))) && document.querySelector('.scr-train .tr-item[data-id="' + id + '"] .av-lv').textContent === 'Lv.' + NG.game.state.roster[id].lv, tid);
    if (!pwOk) fail('training power / list level not refreshed after level up');
    await shot('train_attr_max');
    // star up: pick the owned char with the most spare shards via the list
    const starId = await ev(() => { const l = NG.game.ownedList().filter((o) => NG.game.starCost(o.id) != null && o.e.shards >= NG.game.starCost(o.id)); l.sort((a, b) => b.e.shards - a.e.shards); return l[0] && l[0].id; });
    if (starId) {
      await tap('.scr-train .tr-tabbar [data-tab="star"]', { wait: 300 });
      await page.locator('.scr-train .tr-item[data-id="' + starId + '"]').scrollIntoViewIfNeeded().catch(() => {});
      await tap('.scr-train .tr-item[data-id="' + starId + '"]', { wait: 600 });
      const st0 = await ev((id) => NG.game.state.roster[id].star, starId);
      await tap('.scr-train .st-btn .btn', { wait: 900 });
      const st1 = await ev((id) => NG.game.state.roster[id].star, starId);
      if (st1 !== st0 + 1) fail('star up failed ' + st0 + '→' + st1);
      if (!(await page.textContent('.scr-train .tr-item[data-id="' + starId + '"] .wing span')).startsWith(String(st1))) fail('list star badge not refreshed');
      await shot('train_star_up'); await audit('train star');
    } else warn('no character with enough shards to star up');
    // arrows / swipe / list
    const nmA = await page.textContent('.scr-train .tr-nm .n');
    const idA = await ev(() => document.querySelector('.scr-train .tr-item .av.sel').closest('.tr-item').getAttribute('data-id'));
    await tap('.scr-train .tr-arrow.next', { wait: 500 });
    const idB = await ev(() => document.querySelector('.scr-train .tr-item .av.sel').closest('.tr-item').getAttribute('data-id'));
    if (idB === idA) fail('next arrow did not switch character');
    await tap('.scr-train .tr-arrow.prev', { wait: 500 });
    if (await ev(() => document.querySelector('.scr-train .tr-item .av.sel').closest('.tr-item').getAttribute('data-id')) !== idA) fail('prev arrow did not go back');
    await drag(520, 420, 300, 430);      // swipe left on the hero → next
    if (await ev(() => document.querySelector('.scr-train .tr-item .av.sel').closest('.tr-item').getAttribute('data-id')) !== idB) fail('swipe on hero did not switch to next (' + nmA + ')');
    const sc0 = await ev(() => document.querySelector('.scr-train .tr-list').scrollTop);
    await drag(66, 600, 66, 200);         // drag-scroll the avatar column
    const sc1 = await ev(() => document.querySelector('.scr-train .tr-list').scrollTop);
    if (!(sc1 > sc0 + 50)) fail('drag-scroll of the training list did not scroll (' + sc0 + '→' + sc1 + ')');
    await tap('.scr-train .tr-item:nth-child(6)', { wait: 600 }).catch(() => {});
    await tap('.scr-train .tr-tabbar [data-tab="skill"]', { wait: 600 });
    await shot('train_switched'); await audit('train switched');
    // reference-like long names: render the longest names/forms in the training plate and check fit
    for (const id of ['minato_edo', 'fuguki', 'sakon', 'sasuke_ms', 'indra', 'naruto_sixpaths']) {
      const ok = await ev((id) => { if (!NG.CHAR_MAP[id]) return null; const st = NG.game.state; if (!st.roster[id]) { st.roster[id] = { lv: 1, star: 1, shards: 0, skills: { passive: 1, s1: 1, s2: 1, ult: 1, awaken: 1 }, obtained: Date.now() }; NG.game.save(); } NG.ui.go('train', { id }); return true; }, id);
      if (!ok) continue;
      await sleep(500);
      const fit = await ev(() => { const p = document.querySelector('.scr-train .tr-plate').getBoundingClientRect(), pn = document.querySelector('.scr-train .tr-panel').getBoundingClientRect(), v = NG.ui.view; return v.rot ? p.bottom <= pn.top + 2 : p.right <= pn.left + 2; });
      if (!fit) fail('training name plate overlaps the skill panel for ' + id);
      await audit('train ' + id);
      if (id === 'minato_edo') await shot('train_long_name');
    }

    /* ======================= team ======================= */
    await nav('team');
    await shot('team'); await audit('team');
    for (let i = 0; i < 5; i++) { if (!await vis('.scr-team .tm-slot.filled')) break; await tap('.scr-team .tm-slot.filled', { wait: 250 }); }
    if ((await S()).team.length) fail('could not remove every team member');
    if ((await page.textContent('.scr-team .tm-power .v')).trim() !== '0') fail('team power not 0 with empty team');
    await tap('.scr-team [data-a="go"]', { wait: 400 });
    if (await ev(() => NG.ui.current()) !== 'team') fail('前往冒险 with empty team left the team screen');
    await nav('campaign');
    await tap('.scr-campaign [data-a="fight"]', { wait: 700 });
    if (await ev(() => NG.ui.current()) !== 'team') fail('挑战 with empty team did not redirect to 编队 (' + await ev(() => NG.ui.current()) + ')');
    await shot('team_empty'); await audit('team empty');
    for (let i = 0; i < 3; i++) await tap('.scr-team .tm-it:not(.in)', { wait: 250 });
    if ((await S()).team.length !== 3) fail('manual team add failed: ' + (await S()).team.length);
    await tap('.scr-team [data-a="auto"]', { wait: 500 });
    s = await S();
    if (s.team.length !== 5) fail('一键上阵 gave ' + s.team.length + ' members');
    if ((await page.textContent('.scr-team .tm-power .v')).trim() !== await ev(() => NG.fmt(NG.game.teamPower()))) fail('team power label stale');
    await shot('team_auto');

    /* ======================= campaign ======================= */
    await tap('.scr-team [data-a="go"]', { wait: 800 });
    if (await ev(() => NG.ui.current()) !== 'campaign') fail('前往冒险 did not open 冒险');
    await shot('campaign'); await audit('campaign');
    // double-tap 挑战 → exactly one battle simulation
    await ev(() => { const g = NG.game, f = g.battleStage; window.__bs = 0; g.battleStage = function () { window.__bs++; return f.apply(g, arguments); }; });
    const fight = page.locator('.scr-campaign.on .cp-info [data-a="fight"]');
    if (touch) { await fight.tap(); await fight.tap({ force: true, timeout: 800 }).catch(() => {}); } else await fight.dblclick();
    await sleep(600);
    const bsN = await ev(() => window.__bs);
    if (bsN !== 1) warn('double-tap 挑战 simulated ' + bsN + ' battles');
    let played = 0, lastRes = null, totalStars = 0;
    const MAXST = FULL ? 15 : 6;
    let r = await playBattle('x4', 'battle1');
    played++; lastRes = r; log('stage', played, JSON.stringify(r));
    await shot('battle_result'); await audit('battle result');
    for (; played < MAXST;) {
      if (!lastRes.win) { fail('lost an early stage #' + played); break; }
      if (played % 5 === 4) {           // every 5th: 返回 → 挑战 from the campaign map
        await tap('#modals .res .modal-btns .btn.dark', { wait: 800 });
        await tap('.scr-campaign [data-a="fight"]', { wait: 300 });
      } else {
        if (!lastRes.next) { fail('no 下一关 button after win #' + played); break; }
        const nb = page.locator('#modals .res .modal-btns .btn.red');
        if (touch) { await nb.tap(); await nb.tap({ force: true, timeout: 800 }).catch(() => {}); } else await nb.dblclick();
        await sleep(300);
      }
      const mode = played === 1 || played === 9 ? 'x4' : 'skip';
      r = await playBattle(mode, played === 9 ? 'battle_boss' : null);
      played++; lastRes = r;
      if (played % 4 === 0) log('stage', played, JSON.stringify(r));
    }
    await tap('#modals .res .modal-btns .btn.dark', { wait: 900 });
    s = await S();
    totalStars = Object.values(s.progress).reduce((a, b) => a + b, 0);
    const shown = await ev(() => Array.from(document.querySelectorAll('.scr-campaign .cp-ch .s')).map((e) => +(e.textContent.match(/(\d+)\//) || [0, 0])[1]).reduce((a, b) => a + b, 0));
    if (shown !== totalStars) fail('chapter star totals ' + shown + ' ≠ progress ' + totalStars);
    log('cleared', Object.keys(s.progress).length, 'stages, stars', totalStars);
    await shot('campaign_progress'); await audit('campaign progress');
    // retreat mid-animation, then check nothing keeps running
    await tap('.scr-campaign [data-a="fight"]', { wait: 1600 });
    await tap('.scr-battle [data-a="exit"]', { wait: 400 });
    await tap('#modals .confirm .btn.red', { wait: 600 });
    if (await ev(() => NG.ui.current()) !== 'campaign') fail('撤退 did not return to 冒险');
    await sleep(3800);
    const pend = await ev(() => { const p = window.__qa.pending(); const r0 = window.__qa.raf; return new Promise((res) => setTimeout(() => res({ p, raf: window.__qa.raf - r0 }), 1000)); });
    if (pend.p.timeouts > 1 || pend.p.intervals > 0) fail('timers still pending on idle 冒险 after leaving battle: ' + JSON.stringify(pend.p).slice(0, 400));
    if (pend.raf > 3) fail('rAF loop still running on idle 冒险: ' + pend.raf + ' frames/s');
    if (await page.locator('#fx .cutin, .scr-battle .bt-fx > *').count() > 0) warn('battle FX left in DOM after retreat: ' + await page.locator('#fx .cutin, .scr-battle .bt-fx > *').count());
    // deliberate loss: one weak ninja vs the frontier stage
    await nav('team');
    await tap('.scr-team [data-a="clear"]', { wait: 300 });
    await page.locator('.scr-team .tm-it').last().scrollIntoViewIfNeeded().catch(() => {});
    await tap('.scr-team .tm-it >> nth=-1', { wait: 300 }).catch(async () => { await ev(() => { const l = NG.game.ownedList(); NG.game.setTeam([l[l.length - 1].id]); }); });
    await nav('campaign');
    await tap('.scr-campaign [data-a="fight"]', { wait: 300 });
    r = await playBattle('skip');
    if (r.win) warn('could not lose on purpose (frontier too easy for one weak ninja)');
    else { await shot('battle_lose'); await audit('battle lose'); }
    await tap('#modals .res .tips [data-go="train"]', { wait: 800 }).catch(() => fail('lose screen has no 升级忍者 shortcut'));
    if (await ev(() => NG.ui.current()) !== 'train') fail('lose → 升级忍者 did not open 培养');
    await nav('team'); await tap('.scr-team [data-a="auto"]', { wait: 400 });
    // memory: repeated battles (retry) — DOM nodes and heap must stay flat
    await nav('campaign');
    const prev = await ev(() => { const chs = NG.game.chapters(); for (const c of chs) for (const s of c.stages) if (NG.game.stageState(s.id).stars) return s.id; return null; });
    await ev((sid) => NG.ui.go('campaign', { stage: sid }), prev); await sleep(500);
    await tap('.scr-campaign [data-a="fight"]', { wait: 400 });
    await playBattle('skip');
    const m0 = await heap();
    // retries are driven from inside the page (DOM .click()): CDP element handles from Playwright taps would
    // otherwise keep every closed popup alive and show up as fake heap growth
    await ev(async (n) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const waitSel = async (sel) => { for (let k = 0; k < 600; k++) { const e = document.querySelector(sel); if (e) return e; await sleep(50); } throw new Error('timeout ' + sel); };
      for (let j = 0; j < n; j++) {
        (await waitSel('#modals .mask:not(.out) .res .modal-btns .btn.blue')).click();
        await sleep(250);
        await sleep(j % 3 === 1 ? 1800 : 60);                     // sometimes skip mid-animation
        (await waitSel('.scr-battle [data-a="skip"]')).click();
        await sleep(300); await waitSel('#modals .mask:not(.out) .res'); await sleep(900);
      }
    }, FULL ? 12 : 4);
    const m1 = await heap();
    log('heap/nodes before', JSON.stringify(m0), 'after', JSON.stringify(m1));
    if (m1.nodes > m0.nodes + 150) fail('DOM grows across battles: ' + m0.nodes + ' → ' + m1.nodes);
    if (m1.mb > m0.mb + 6) fail('JS heap grows across battles: ' + m0.mb + ' → ' + m1.mb + ' MB');
    // hardware back / Esc on the (mandatory) result popup = 返回, never a dead battle screen
    if (touch) { await page.goBack().catch(() => {}); await sleep(900); } else { await page.keyboard.press('Escape'); await sleep(900); }
    if (await ev(() => NG.ui.current()) !== 'campaign' || await vis('#modals .res')) { fail('back on the battle result did not return to 冒险 (' + await ev(() => NG.ui.current()) + ')'); await tryTap('#modals .res .modal-btns .btn.dark', { wait: 700 }); }

    /* ======================= codex ======================= */
    await nav('codex');
    await sleep(800); await shot('codex'); await audit('codex');
    const counts = await ev(() => {
      const out = [], pills = Array.from(document.querySelectorAll('.scr-codex [data-f] .pill'));
      return pills.map((p) => [p.closest('[data-f]').getAttribute('data-f'), p.getAttribute('data-v')]);
    });
    for (const [f, v] of counts) {
      await page.locator('.scr-codex [data-f="' + f + '"] .pill[data-v="' + v + '"]').scrollIntoViewIfNeeded().catch(() => {});
      await tap('.scr-codex [data-f="' + f + '"] .pill[data-v="' + v + '"]', { wait: 120 });
      await waitFor(() => { const g = document.querySelector('.scr-codex .cx-grid'); return g._chunkDone || g.querySelector('.cx-empty'); }, null, 5000).catch(() => {});
      const got = await ev(([f, v]) => {
        const want = NG.CHARS.filter((c) => (f !== 'fac' || v === 'all' || c.faction === v) && (f !== 'rar' || v === 'all' || c.rarity === v) && (f !== 'role' || v === 'all' || c.role === v) && (f !== 'own' || v === 'all' || (v === 'own') === !!NG.game.state.roster[c.id])).length;
        return [want, document.querySelectorAll('.scr-codex .cx-grid .cx-card').length];
      }, [f, v]);
      if (got[0] !== got[1] && got[1] !== 0) fail('codex filter ' + f + '=' + v + ' shows ' + got[1] + ' cards, expected ' + got[0]);
      if (v !== 'all') await tap('.scr-codex [data-f="' + f + '"] .pill[data-v="all"]', { wait: 150 });
    }
    await tap('.scr-codex [data-f="own"] .pill[data-v="not"]', { wait: 400 });
    if (await vis('.scr-codex .cx-card')) { await tap('.scr-codex .cx-card', { wait: 600 }); await shot('codex_detail_unowned'); await audit('codex detail unowned'); await tap('.modal-x', { wait: 400 }); }
    await tap('.scr-codex [data-f="own"] .pill[data-v="all"]', { wait: 400 });
    await tap('.scr-codex .cx-card', { wait: 700 }); await shot('codex_detail'); await audit('codex detail');
    await drag(800, 600, 800, 350); await tap('.modal-x', { wait: 400 });
    for (let i = 0; i < 6; i++) await drag(640, 640, 640, 250, 8);
    await sleep(500); await shot('codex_scrolled'); await audit('codex scrolled');
    const blank = await ev(() => Array.from(document.querySelectorAll('.scr-codex .cx-card')).filter((c) => { const r = c.getBoundingClientRect(), g = document.querySelector('.scr-codex .cx-grid').getBoundingClientRect(); return r.top > g.top && r.bottom < g.bottom && !(c.querySelector('.pic img').classList.contains('ld')); }).length);
    if (blank) fail('codex: ' + blank + ' visible cards never loaded their portrait');

    /* ======================= AFK chest ======================= */
    await nav('home');
    await sleep(1500);
    const c0 = (await S()).coins;
    await tap('.scr-home .home-afk', { wait: 500 }); await shot('afk'); await audit('afk');
    await tap('#modals .modal-btns .btn', { wait: 600 });
    const c1 = (await S()).coins;
    if (!(c1 > c0)) fail('AFK claim did not add coins (' + c0 + '→' + c1 + ')');
    await checkCur('after afk');
    await tap('.scr-home .home-afk', { wait: 400 }); await tap('#modals .modal-btns .btn', { wait: 400 });   // nothing to claim → stays open with toast
    if (await vis('#modals .afk')) await tap('.modal-x', { wait: 300 });

    /* ======================= settings ======================= */
    await nav('settings');
    await shot('settings'); await audit('settings');
    await tap('.scr-settings [data-set="rotate"] [data-v="off"]', { wait: 500 });
    let vw = await ev(() => NG.ui.view);
    if (vw.rot) fail('rotate off still rotated');
    if (VP === 'portrait') await shot('settings_rotate_off');
    await tap('.scr-settings [data-set="rotate"] [data-v="auto"]', { wait: 500 });
    vw = await ev(() => NG.ui.view);
    if ((VP === 'portrait' || VP === 'ipad') !== !!vw.rot) fail('rotate auto state wrong: ' + JSON.stringify(vw));
    await tap('.scr-settings [data-set="speed"] [data-v="2"]', { wait: 300 });
    if ((await S()).speed !== 2) fail('speed setting not saved');

    /* ======================= reload (persistence) ======================= */
    const pre = await S();
    await page.reload();
    await page.waitForSelector('#boot', { state: 'detached', timeout: 15000 }); await sleep(800);
    const post = await S();
    ['tickets', 'gems', 'coins', 'roster', 'pulls', 'speed', 'name'].forEach((k) => { if (pre[k] !== post[k]) fail('reload lost ' + k + ': ' + pre[k] + ' → ' + post[k]); });
    if (JSON.stringify(pre.progress) !== JSON.stringify(post.progress)) fail('reload lost progress');
    if (JSON.stringify(pre.team) !== JSON.stringify(post.team)) fail('reload lost team');
    if (await vis('#modals .welcome')) fail('welcome shown again after reload');
    note('after reload opened screen: ' + await ev(() => NG.ui.current()));
    await audit('after reload');

    /* ======================= orientation / resize ======================= */
    if (VP !== 'desktop') {
      const vp = conf.viewport;
      await page.setViewportSize({ width: vp.height, height: vp.width }); await sleep(500);
      const flip = await ev(() => NG.ui.view);
      const sr = await ev(() => { const r = document.getElementById('stage').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom, innerWidth, innerHeight]; });
      if (sr[0] < -1 || sr[1] < -1 || sr[2] > sr[4] + 1 || sr[3] > sr[5] + 1) fail('stage does not fit after orientation change: ' + sr.join(','));
      await shot('orientation_flipped');
      await page.setViewportSize(vp); await sleep(500);
      log('flip view', JSON.stringify(flip));
    }

    /* ======================= reset ======================= */
    await nav('settings');
    await tap('.scr-settings [data-act="reset"]', { wait: 500 }); await shot('reset_confirm');
    await tap('#modals .confirm .btn.red', { wait: 1500 });
    s = await S();
    if (s.tickets !== 1000 || Object.keys(s.progress).length || s.welcomed || s.pulls) fail('reset did not wipe the save: ' + JSON.stringify(s).slice(0, 200));
    if (!await vis('#modals .welcome')) fail('welcome not shown after reset');
    if (await ev(() => NG.ui.current()) !== 'home') fail('reset did not return to 主城');
    await checkCur('after reset');
    await shot('after_reset');
    await audit('after reset');
  } catch (e) {
    fail('FLOW ABORTED: ' + (e.stack || e.message).split('\n').slice(0, 4).join(' | '));
    await shot('aborted').catch(() => {});
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ vp: VP, errors, warns, notes, shots }, null, 1));
  console.log(`\n[${VP}] ===== ${errors.length} errors, ${warns.length} warnings =====`);
  errors.forEach((e) => console.log('  E ' + e));
  Array.from(new Set(warns)).forEach((e) => console.log('  W ' + e));
  process.exit(errors.length ? 1 : 0);
})();
