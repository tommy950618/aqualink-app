/* DEV ONLY — memory / leak probe: replays the same stage N times (retry + skip, and some full ×4 replays)
 * and prints JS heap + DOM node count after forced GC. Also measures long tasks for opening 图鉴 and starting
 * a battle under 4× CPU throttling.
 *   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/_mem.js [rounds] */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8133/index.html';
const N = +(process.argv[2] || 30);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--disable-gpu'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, body: '' }));
  await page.addInitScript(() => {
    window.__lt = [];
    try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push({ t: e.startTime, d: Math.round(e.duration) }))).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  });
  const cdp = await ctx.newCDPSession(page);
  async function heap(tag) {
    for (let i = 0; i < 3; i++) { await cdp.send('HeapProfiler.collectGarbage'); await sleep(150); }
    const h = await cdp.send('Runtime.getHeapUsage');
    const d = await page.evaluate(() => ({ nodes: document.getElementsByTagName('*').length, fx: document.querySelectorAll('.bt-fx > *').length, anims: document.getAnimations().length }));
    console.log(tag.padEnd(14), (h.usedSize / 1048576).toFixed(2) + 'MB', JSON.stringify(d));
    return h.usedSize;
  }
  await page.goto(BASE);
  await page.waitForSelector('#boot', { state: 'detached' });
  await page.evaluate(() => { NG.ui.closeModals(); NG.game.setFlag('welcomed', true); NG.game.summon(100); NG.game.summon(100); NG.game.autoTeam(); });
  await sleep(500);

  /* ---- long tasks under 4× CPU throttle ---- */
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const lt = async (label, fn, wait) => {
    await page.evaluate(() => { window.__lt.length = 0; });
    const t0 = Date.now(); await fn(); await sleep(wait || 1500);
    const l = await page.evaluate(() => window.__lt.slice());
    console.log('LONGTASKS', label.padEnd(16), 'max', Math.max(0, ...l.map((x) => x.d)) + 'ms', 'n', l.length, l.map((x) => x.d).join(','), '(' + (Date.now() - t0) + 'ms wall)');
  };
  await lt('open 图鉴', () => page.evaluate(() => NG.ui.go('codex')), 2500);
  await lt('scroll 图鉴', async () => { for (let i = 0; i < 10; i++) { await page.mouse.move(640, 500); await page.mouse.wheel(0, 400); await sleep(120); } }, 1500);
  await lt('filter 图鉴', () => page.evaluate(() => document.querySelector('.scr-codex [data-f="rar"] .pill[data-v="SSR"]').click()), 1500);
  await lt('detail 图鉴', () => page.evaluate(() => document.querySelector('.scr-codex .cx-card').click()), 1500);
  await page.evaluate(() => NG.ui.closeModals());
  await lt('open 培养', () => page.evaluate(() => NG.ui.go('train')), 2000);
  await lt('open 编队', () => page.evaluate(() => NG.ui.go('team')), 2000);
  await lt('open 冒险', () => page.evaluate(() => NG.ui.go('campaign')), 2000);
  await lt('start battle', () => page.evaluate(() => NG.ui.startBattle(NG.game.chapters()[0].stages[0].id)), 2500);
  await lt('battle playback', async () => {}, 4000);
  await lt('battle skip→res', () => page.evaluate(() => document.querySelector('.scr-battle [data-a="skip"]').click()), 2000);
  await lt('open 召唤', () => page.evaluate(() => { NG.ui.closeModals(); NG.ui.go('summon'); }), 2000);
  await lt('十连 reveal', () => page.evaluate(() => document.querySelector('.scr-summon .sm-btn[data-n="10"]').click()), 3000);
  await page.evaluate(() => { const s = document.querySelector('.rv .rv-skip'); if (s) s.click(); });
  await sleep(1500);
  await page.evaluate(() => { const b = document.querySelector('.rv-bar [data-a="ok"]'); if (b) b.click(); });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  /* ---- repeated battles ---- */
  const sid = await page.evaluate(() => NG.game.chapters()[0].stages[0].id);
  await page.evaluate((sid) => { NG.ui.closeModals(); NG.ui.go('campaign', { stage: sid }); NG.ui.startBattle(sid); }, sid);
  await page.waitForSelector('.scr-battle [data-a="skip"]'); await page.click('.scr-battle [data-a="skip"]');
  await page.waitForSelector('#modals .res'); await sleep(1000);
  const h0 = await heap('start');
  // drive the retries from inside the page (DOM .click()) so no CDP element handles keep old popups alive
  for (let i = 10; i <= N; i += 10) {
    await page.evaluate(async (n) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const waitSel = async (sel) => { for (let k = 0; k < 600; k++) { const e = document.querySelector(sel); if (e) return e; await sleep(50); } throw new Error('timeout ' + sel); };
      for (let j = 1; j <= n; j++) {
        (await waitSel('#modals .mask:not(.out) .res .modal-btns .btn.blue')).click();
        await sleep(200);
        if (j % 10 === 5) NG.ui.setSetting('speed', 4);
        else { await sleep(j % 3 === 0 ? 1500 : 50); (await waitSel('.scr-battle [data-a="skip"]')).click(); }
        await sleep(300);
        await waitSel('#modals .mask:not(.out) .res');
        await sleep(800);
      }
    }, 10);
    await heap('after ' + i);
  }
  const h1 = await heap('end');
  console.log('heap delta', ((h1 - h0) / 1048576).toFixed(2), 'MB over', N, 'battles');
  if (process.env.SNAP) {
    // aggregate heap by constructor/type at start vs end of a further batch of battles
    const agg = async () => {
      const chunks = []; const on = (p) => chunks.push(p.chunk);
      cdp.on('HeapProfiler.addHeapSnapshotChunk', on);
      await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
      cdp.off('HeapProfiler.addHeapSnapshotChunk', on);
      const snap = JSON.parse(chunks.join('')), f = snap.snapshot.meta.node_fields, nf = f.length, types = snap.snapshot.meta.node_types[0];
      const iT = f.indexOf('type'), iN = f.indexOf('name'), iS = f.indexOf('self_size'), out = {};
      for (let i = 0; i < snap.nodes.length; i += nf) {
        const k = types[snap.nodes[i + iT]] + ':' + String(snap.strings[snap.nodes[i + iN]]).slice(0, 60);
        const o = out[k] || (out[k] = { n: 0, b: 0 }); o.n++; o.b += snap.nodes[i + iS];
      }
      return out;
    };
    const a = await agg();
    for (let i = 1; i <= 10; i++) { await page.click('#modals .res .modal-btns .btn.blue'); await sleep(100); await page.click('.scr-battle [data-a="skip"]'); await page.waitForSelector('#modals .res'); await sleep(700); }
    for (let i = 0; i < 3; i++) { await cdp.send('HeapProfiler.collectGarbage'); await sleep(150); }
    const b = await agg();
    const diff = Object.keys(b).map((k) => [k, b[k].n - ((a[k] || {}).n || 0), b[k].b - ((a[k] || {}).b || 0)]).filter((x) => x[2] > 20000 || x[1] > 300).sort((x, y) => y[2] - x[2]).slice(0, 25);
    diff.forEach((d) => console.log('GROW', d[0].padEnd(64), '+' + d[1], '+' + (d[2] / 1024).toFixed(0) + 'KB'));
  }
  console.log(errs.length ? 'ERRORS ' + errs.join('\n') : 'NO ERRORS');
  await browser.close();
})();
