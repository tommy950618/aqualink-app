/* DEV ONLY — simulates publishing as a claude.ai Artifact: index.html is stripped of doctype/html/head/body
 * (title/meta/link/style/body content kept in order), wrapped in a fresh skeleton whose :root is padded like the
 * host does, served next to js/ + css/, and loaded in an iframe sandboxed with allow-scripts only (opaque origin →
 * localStorage/sessionStorage throw, no alert/confirm/prompt, no popups, no downloads). Plays a short session,
 * resizes the iframe (landscape ↔ portrait ↔ tiny) and checks the stage re-fits without page scroll.
 * Also runs a top-level pass where localStorage exists but every call throws.
 *   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/_artifact.js [outDir] */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const OUT = process.argv[2] || '/tmp/claude-0/-home-user-aqualink-app/7b37f5eb-8962-565a-b27d-4cf648e4c413/scratchpad/qa/artifact';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const fail = (m) => { errors.push(m); console.log('FAIL', m); };

function wrap(html) {
  let body = html.replace(/<!doctype[^>]*>/i, '').replace(/<\/?html[^>]*>/gi, '').replace(/<\/?head[^>]*>/gi, '').replace(/<\/?body[^>]*>/gi, '');
  return '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<style>:root{padding-top:max(env(safe-area-inset-top),14px);padding-bottom:max(env(safe-area-inset-bottom),14px)}body{margin:0}</style></head><body>' + body + '</body></html>';
}
const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const wrapped = wrap(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
fs.writeFileSync(path.join(OUT, 'wrapped.html'), wrapped);
const host = '<!doctype html><html><head><meta charset=utf-8><style>html,body{margin:0;background:#222}iframe{border:0;display:block}</style></head><body>' +
  '<iframe id="f" sandbox="allow-scripts" src="/wrapped.html" style="width:900px;height:506px"></iframe></body></html>';
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/host.html') { res.writeHead(200, { 'content-type': TYPES['.html'] }); return res.end(host); }
  if (u === '/wrapped.html') { res.writeHead(200, { 'content-type': TYPES['.html'] }); return res.end(wrapped); }
  const f = path.join(ROOT, u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'access-control-allow-origin': '*' });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(8135, r));
  const browser = await chromium.launch({ args: ['--disable-gpu'] });
  /* ---------- 1. sandboxed iframe like the artifact viewer ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') fail('console.error: ' + m.text()); });
    page.on('pageerror', (e) => fail('pageerror: ' + e.message));
    page.on('request', (r) => { const u = r.url(); if (!/^http:\/\/localhost:8135\//.test(u) && !/^data:|^blob:/.test(u) && !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u)) fail('external request ' + u); });
    page.on('dialog', (d) => { fail('native dialog ' + d.type()); d.dismiss(); });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.goto('http://localhost:8135/host.html');
    const fr = page.frameLocator('#f');
    const frame = () => page.frames().find((f) => /wrapped\.html/.test(f.url()));
    await sleep(500);
    const F = frame();
    await F.waitForSelector('#boot', { state: 'detached', timeout: 15000 });
    const info = await F.evaluate(() => {
      let ls = 'ok'; try { window.localStorage.getItem('x'); } catch (e) { ls = 'throws: ' + e.name; }
      return { origin: String(window.origin), ls, lang: document.documentElement.lang, welcomed: !!NG.game.state.flags.welcomed, view: NG.ui.view };
    });
    console.log('sandbox frame', JSON.stringify(info));
    if (!/throws/.test(info.ls)) console.log('note: localStorage did not throw in the sandbox');
    if (info.lang !== 'zh-CN') fail('lang not set from JS');
    await F.waitForSelector('#modals .welcome', { timeout: 5000 });
    await page.screenshot({ path: path.join(OUT, '01_sandbox_welcome.png') });
    await fr.locator('.welcome .btn').click(); await sleep(700);
    await fr.locator('.scr-summon.on .sm-btn[data-n="10"]').click(); await sleep(400);
    for (let i = 0; i < 60; i++) {
      if (await fr.locator('.rv-bar:not(.hidden) [data-a="ok"]').count()) break;
      const sk = fr.locator('.ur-show .rv-skip, .rv > .rv-skip:not(.hidden)');
      if (await sk.count()) await sk.first().click({ timeout: 1000 }).catch(() => {});
      await sleep(200);
    }
    await sleep(600);
    await page.screenshot({ path: path.join(OUT, '02_sandbox_pull10.png') });
    await fr.locator('.rv-bar [data-a="ok"]').click(); await sleep(500);
    await F.evaluate(() => NG.ui.go('campaign')); await sleep(600);
    await fr.locator('.scr-campaign [data-a="fight"]').click(); await sleep(1500);
    await page.screenshot({ path: path.join(OUT, '03_sandbox_battle.png') });
    await fr.locator('.scr-battle [data-a="skip"]').click();
    await F.waitForSelector('#modals .res', { timeout: 20000 }); await sleep(1200);
    await page.screenshot({ path: path.join(OUT, '04_sandbox_result.png') });
    // the in-page reset confirm (no native confirm) must work in the sandbox
    await fr.locator('#modals .res .modal-btns .btn.dark').click(); await sleep(600);
    await F.evaluate(() => NG.ui.go('settings')); await sleep(500);
    await fr.locator('.scr-settings [data-act="reset"]').click(); await sleep(400);
    await fr.locator('#modals .confirm .btn.red').click(); await sleep(1200);
    if (!await fr.locator('#modals .welcome').count()) fail('welcome missing after reset in sandbox');
    await F.evaluate(() => NG.ui.closeModals());
    // iframe resizes (host changes the frame size): must re-fit, never scroll
    const sizes = [[420, 760], [1000, 420], [320, 200], [700, 700], [900, 506]];
    for (const [w, h] of sizes) {
      await page.evaluate(([w, h]) => { const f = document.getElementById('f'); f.style.width = w + 'px'; f.style.height = h + 'px'; }, [w, h]);
      await sleep(400);
      const r = await F.evaluate(() => { const b = document.getElementById('stage').getBoundingClientRect(); return { b: [b.left, b.top, b.right, b.bottom].map(Math.round), vw: innerWidth, vh: innerHeight, rot: NG.ui.view.rot, s: +NG.ui.view.s.toFixed(3), sx: scrollX, sy: scrollY, de: document.scrollingElement.scrollTop }; });
      const fits = r.b[0] >= -1 && r.b[1] >= -1 && r.b[2] <= r.vw + 1 && r.b[3] <= r.vh + 1;
      const fills = Math.max(r.b[2] - r.b[0], r.b[3] - r.b[1]) >= Math.max(r.vw, r.vh) * 0.9 || Math.min(r.b[2] - r.b[0], r.b[3] - r.b[1]) >= Math.min(r.vw, r.vh) * 0.75;
      console.log('iframe', w + 'x' + h, JSON.stringify(r), fits ? 'fits' : 'OVERFLOWS', fills ? '' : 'small');
      if (!fits) fail('stage does not fit iframe ' + w + 'x' + h);
      if (r.sx || r.sy || r.de) fail('iframe document scrolled at ' + w + 'x' + h);
      if ((h > w) !== r.rot) fail('rotation wrong for ' + w + 'x' + h);
      await page.screenshot({ path: path.join(OUT, '05_resize_' + w + 'x' + h + '.png') });
    }
    await ctx.close();
  }
  /* ---------- 2. top level, storage present but every call throws ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript(() => {
      const bad = { getItem() { throw new Error('QuotaExceededError'); }, setItem() { throw new Error('QuotaExceededError'); }, removeItem() { throw new Error('denied'); }, clear() { throw new Error('denied'); }, key() { throw new Error('denied'); }, get length() { throw new Error('denied'); } };
      Object.defineProperty(window, 'localStorage', { get() { return bad; } });
      Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('SecurityError'); } });
    });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') fail('[throwing storage] console.error: ' + m.text()); });
    page.on('pageerror', (e) => fail('[throwing storage] pageerror: ' + e.message));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.goto('http://localhost:8135/index.html');
    await page.waitForSelector('#boot', { state: 'detached', timeout: 15000 });
    await page.click('.welcome .btn'); await sleep(600);
    await page.click('.scr-summon.on .sm-btn[data-n="1"]'); await sleep(300);
    for (let i = 0; i < 40; i++) { if (await page.locator('.rv-bar:not(.hidden) [data-a="ok"]').count()) break; const s = page.locator('.ur-show'); if (await s.count()) await s.click({ force: true }).catch(() => {}); await sleep(250); }
    await page.click('.rv-bar [data-a="ok"]'); await sleep(400);
    await page.evaluate(() => NG.ui.go('train')); await sleep(600);
    await page.click('.scr-train .tr-tabbar [data-tab="attr"]'); await page.click('.scr-train .at-btns [data-n="max"]'); await sleep(500);
    const lv = await page.evaluate(() => NG.game.ownedList()[0].e.lv);
    if (!(lv > 1)) fail('[throwing storage] level up did not work');
    await page.screenshot({ path: path.join(OUT, '06_throwing_storage.png') });
    console.log('throwing storage pass: level', lv);
    await ctx.close();
  }
  await browser.close();
  server.close();
  console.log(errors.length ? 'ERRORS (' + errors.length + ')\n' + errors.join('\n') : 'NO ERRORS');
  process.exit(errors.length ? 1 : 0);
})();
