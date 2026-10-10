'use strict';
/**
 * @module test/harness
 * Playwright harness for the static game one directory up (spec v2 §9.1).
 *
 * - `startServer(dir, opts)`: one dependency-free static server. The game folder is served at
 *   `/games/nba2k-threejs/` (the path it has in the repository, so the page runs at the same directory depth as on
 *   static hosting) and, for older scripts, also at `/`. `.bin` files go out as `application/octet-stream` (H11).
 *   Extra in-memory pages can be added with `addPage(path, html)` (B43 hosts the game inside an iframe this way).
 * - `DEVICES`: the 8 devices of §9.1 (+ the legacy v1 names `androidPortrait` and `iphoneSE` keep working).
 * - `launchBrowser()`: headless Chromium with SwiftShader through ANGLE (`--use-angle=swiftshader`), classified
 *   `software` by `quality.detectStatic` → rung 2 (low) unless `?quality=` forces a tier. Frame rates are never
 *   asserted headless; counts and bytes are.
 * - `openGame({...})`: new browser context + page for a device, with diagnostics (console errors, uncaught
 *   exceptions, failed requests, every request URL) collected in `diag`.
 * - Game helpers: `startGame` (`index.html?quick=1&intro=0&seed=7` → click 快速比赛 → `await __game.legendsReady`
 *   → CHECK/LIVE), `openLineup` (title → 开始游戏 → lineup screen), `forceTier` (`?quality=`), `frameStats`
 *   (draw calls / triangles / texMB of one complete frame), `waitTitle`, `dismissRotateHint`.
 * - Touch: `touchDrag`, `touchTap`, `multiTouch` dispatch real touch sequences through CDP (pointerType 'touch').
 *
 * Usage as a script: `node test/harness.cjs [--device phoneLandscape] [--out test/shots] [--query "?quick=1"]`
 * loads the page, waits for the title (or 15 s), saves a screenshot and prints diagnostics + an fps sample.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const { chromium } = (() => {
  try { return require('playwright'); } catch (e) { return require('/opt/node22/lib/node_modules/playwright'); }
})();

/** URL path under which the game folder is served (spec §9.1). */
const GAME_PREFIX = '/games/nba2k-threejs/';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.webmanifest': 'application/manifest+json', '.bin': 'application/octet-stream',
};

/**
 * Starts the static server. Backwards compatible with v1 (`startServer(dir)` → `{server, url}` where
 * `url + 'index.html'` is the game page); `url` is now `http://127.0.0.1:<port>/games/nba2k-threejs/`.
 * @param {string} dir  folder to serve (the game folder)
 * @param {number|{port?:number, prefix?:string, log?:boolean}} [opts]
 * @returns {Promise<{server, url, origin, prefix, addPage(p, html, type?), served: Array, close()}>}
 */
function startServer(dir, opts) {
  const o = typeof opts === 'number' ? { port: opts } : (opts || {});
  const prefix = o.prefix || GAME_PREFIX;
  const root = path.resolve(dir);
  const pages = new Map();
  const served = [];
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let p;
      try { p = decodeURIComponent(req.url.split('?')[0].split('#')[0]); } catch (e) { res.writeHead(400); res.end('bad url'); return; }
      if (pages.has(p)) {
        const pg = pages.get(p);
        res.writeHead(200, { 'Content-Type': pg.type, 'Cache-Control': 'no-store' });
        res.end(pg.body);
        return;
      }
      let rel = p.startsWith(prefix) ? p.slice(prefix.length) : p.replace(/^\/+/, '');
      if (rel === '' || rel.endsWith('/')) rel += 'index.html';
      const file = path.join(root, rel);
      if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403); res.end('403'); return; }
      let st = null;
      try { st = fs.statSync(file); } catch (e) { st = null; }
      if (!st || st.isDirectory()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404 ' + p); return; }
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-store' });
      served.push({ path: p, bytes: st.size });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(file).pipe(res);
    });
    server.on('error', reject);
    server.listen(o.port || 0, '127.0.0.1', () => {
      const origin = `http://127.0.0.1:${server.address().port}`;
      resolve({
        server, origin, prefix, served,
        url: origin + prefix,
        addPage(p, body, type = 'text/html; charset=utf-8') { pages.set(p, { body, type }); return origin + p; },
        close() { return new Promise((r) => server.close(() => r())); },
      });
    });
  });
}

const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const UA_PIXEL = 'Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 12; SM-A125F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const UA_IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const touchDev = (w, h, dpr, ua) => ({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true, userAgent: ua });

/** The 8 devices of spec §9.1 (B20/B36 iterate over `VIEWPORT_DEVICES`). */
const DEVICES = {
  desktop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  phonePortrait: touchDev(390, 844, 2, UA_IPHONE),      // iPhone 11
  phoneLandscape: touchDev(844, 390, 2, UA_IPHONE),     // iPhone 11 rotated
  androidPortrait: touchDev(393, 851, 2.75, UA_PIXEL),  // Pixel 5
  androidSmall: touchDev(360, 640, 3, UA_ANDROID),      // small Android
  landscapeShort: touchDev(740, 304, 3, UA_ANDROID),    // Android landscape with browser chrome
  seLandscape: touchDev(568, 320, 2, UA_IPHONE),        // iPhone SE landscape
  tabletLandscape: touchDev(1024, 768, 2, UA_IPAD),     // iPad landscape
};
/** Device names in §9.1 order (the "8 viewports"). */
const VIEWPORT_DEVICES = Object.freeze(['desktop', 'phonePortrait', 'phoneLandscape', 'androidPortrait', 'androidSmall', 'landscapeShort', 'seLandscape', 'tabletLandscape']);
// v1 aliases kept for scratch scripts
DEVICES.iphoneSE = touchDev(375, 667, 2, UA_IPHONE);

/** Chromium flags: SwiftShader through ANGLE (spec §9.1). */
const BROWSER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--js-flags=--expose-gc', '--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required'];

/** Launches headless Chromium with the harness flags. */
function launchBrowser({ headless = true, args = [] } = {}) {
  return chromium.launch({ headless, args: BROWSER_ARGS.concat(args) });
}

/**
 * Opens a page for a device. Creates its own browser unless `browser` is given (then only a new context).
 * @param {object} o
 * @param {string} [o.dir]  game folder (a server is started when `url` is not given)
 * @param {string} [o.device='phonePortrait']
 * @param {string} [o.url]  base URL of the game folder (from startServer); `page` is resolved against it
 * @param {string} [o.page='index.html']  path + query relative to the game folder (or an absolute URL)
 * @param {object} [o.browser]  shared browser
 * @param {Function|string|Array} [o.init]  addInitScript payload(s) run before any page script (every frame)
 * @param {boolean} [o.navigate=true]  false → return before navigating (caller does page.goto)
 * @param {object} [o.context]  extra newContext options (merged over the device)
 * @returns {Promise<{page, ctx, browser, diag, close(), url, target}>}
 */
async function openGame(o) {
  const { dir, device = 'phonePortrait', url: baseUrl, page: pagePath = 'index.html', headless = true, navigate = true } = o;
  let srv = null;
  let base = baseUrl;
  if (!base) { srv = await startServer(dir); base = srv.url; }
  const ownBrowser = !o.browser;
  const browser = o.browser || await launchBrowser({ headless });
  if (!DEVICES[device]) throw new Error(`unknown device "${device}" (known: ${Object.keys(DEVICES).join(', ')})`);
  const ctx = await browser.newContext(Object.assign({}, DEVICES[device], o.context || {}));
  const inits = o.init == null ? [] : (Array.isArray(o.init) ? o.init : [o.init]);
  for (const s of inits) await ctx.addInitScript(s);
  const page = await ctx.newPage();
  const diag = { errors: [], warnings: [], logs: [], pageErrors: [], failedRequests: [], requests: [], responses: [] };
  page.on('console', (m) => { const ty = m.type(); const txt = m.text(); if (ty === 'error') diag.errors.push(txt); else if (ty === 'warning') diag.warnings.push(txt); else diag.logs.push(`[${ty}] ${txt}`); });
  page.on('pageerror', (e) => diag.pageErrors.push(String((e && e.stack) || e)));
  page.on('request', (r) => diag.requests.push({ url: r.url(), t: Date.now(), type: r.resourceType(), frame: r.frame() === page.mainFrame() ? 'main' : 'sub' }));
  page.on('requestfailed', (r) => { const f = r.failure(); const err = f && f.errorText; if (err && /ERR_ABORTED/.test(err) && diag.ignoreAborted) return; diag.failedRequests.push(`${r.url()} ${err}`); });
  page.on('response', (r) => { diag.responses.push({ url: r.url(), status: r.status() }); if (r.status() >= 400) diag.failedRequests.push(`${r.url()} HTTP ${r.status()}`); });
  const target = /^https?:/.test(pagePath) ? pagePath : base + pagePath.replace(/^\/+/, '');
  if (navigate) await page.goto(target, { waitUntil: 'load' });
  const close = async () => {
    await ctx.close().catch(() => {});
    if (ownBrowser) await browser.close().catch(() => {});
    if (srv) await srv.close();
  };
  return { page, ctx, browser, diag, close, url: base, target };
}

/** `url` with `quality=<tier>` set (replacing an existing value). */
function forceTier(url, tier) {
  const [p, q = ''] = url.split('?');
  const parts = q.split('&').filter((s) => s && !/^quality=/.test(s));
  parts.push('quality=' + tier);
  return p + '?' + parts.join('&');
}

/** Waits until a `__game` property path is truthy (page context), up to `ms`. */
async function waitGame(page, expr, ms = 60000, label) {
  try {
    await page.waitForFunction(new Function(`try { const g = window.__game; return !!(${expr}); } catch (e) { return false; }`), null, { timeout: ms, polling: 50 });
  } catch (e) {
    throw new Error(`timeout ${ms} ms waiting for ${label || expr}`);
  }
}

/** True when the element exists and is rendered visibly. */
function isVisible(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }, sel);
}

/** Taps (touch devices) or clicks the centre of an element. */
async function tapSelector(page, sel) {
  const box = await page.locator(sel).first().boundingBox();
  if (!box) throw new Error(`${sel} has no bounding box`);
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const touch = await page.evaluate(() => matchMedia('(hover: none)').matches || navigator.maxTouchPoints > 0);
  if (touch) await touchTap(page, c); else await page.mouse.click(c.x, c.y);
}

/** Dismisses the portrait rotate hint when it is showing (知道了). */
async function dismissRotateHint(page) {
  if (await isVisible(page, '#rotateHint')) await page.locator('#btnRotateDismiss').click({ timeout: 3000 }).catch(() => {});
}

/** Waits for the title screen (`__game.ui.screen === 'title'` and #btnQuick visible). */
async function waitTitle(page, ms = 90000) {
  await waitGame(page, "g && g.ui && g.ui.screen === 'title'", ms, "__game.ui.screen === 'title'");
  await page.locator('#btnQuick').waitFor({ state: 'visible', timeout: 10000 });
}

/**
 * Spec §9.1 `startGame`: the page must have been opened with `index.html?quick=1&intro=0&seed=7` (or any query);
 * waits for the title, clicks 快速比赛, awaits `__game.legendsReady` and returns when the game is in CHECK or LIVE.
 * @returns {Promise<{readyMs:number, checkMs:number}>} times from the click
 */
async function startGame(page, { timeout = 90000, state = ['CHECK', 'LIVE'] } = {}) {
  await waitTitle(page, timeout);
  await dismissRotateHint(page);
  const t0 = Date.now();
  await page.locator('#btnQuick').click({ timeout: 10000 });
  await page.evaluate(() => Promise.resolve(window.__game.legendsReady).then(() => true, () => true));
  const readyMs = Date.now() - t0;
  await waitGame(page, `${JSON.stringify(state)}.includes(g.state)`, timeout, `__game.state ∈ ${state.join('/')}`);
  return { readyMs, checkMs: Date.now() - t0 };
}

/** Title → 开始游戏 → lineup screen (`__game.ui.screen === 'lineup'`). */
async function openLineup(page, { timeout = 90000 } = {}) {
  await waitTitle(page, timeout);
  await dismissRotateHint(page);
  await page.locator('#btnStart').click({ timeout: 10000 });
  await waitGame(page, "g.ui && g.ui.screen === 'lineup'", 20000, "__game.ui.screen === 'lineup'");
  await page.locator('#screenLineup .card').first().waitFor({ state: 'visible', timeout: 10000 });
}

/** Resolves after `n` animation frames. */
function nextFrames(page, n = 2) {
  return page.evaluate((k) => new Promise((res) => { let m = k; const tick = () => (--m <= 0 ? res(true) : requestAnimationFrame(tick)); requestAnimationFrame(tick); }), n);
}

/**
 * Draw calls / triangles / texMB of one complete frame: waits for two rendered frames, then reads `__game.perf`
 * (written by main.js from `renderer.info` with `autoReset = false`, all passes counted, §7.5).
 */
async function frameStats(page) {
  await nextFrames(page, 3);
  return page.evaluate(() => {
    const p = window.__game.perf || {};
    return { calls: p.drawCalls, tris: p.triangles, texMB: p.texMB, stepMs: p.stepMs, animMs: p.animMs, frameMs: p.frameMs };
  });
}

/** Rendered frames per second over `ms` (requestAnimationFrame count). */
async function measureFps(page, ms = 3000) {
  return page.evaluate((d) => new Promise((resolve) => {
    let frames = 0; const t0 = performance.now();
    const tick = () => { frames++; if (performance.now() - t0 < d) requestAnimationFrame(tick); else resolve(frames / ((performance.now() - t0) / 1000)); };
    requestAnimationFrame(tick);
  }), ms);
}

/** Real touch drag through CDP so pointer events carry pointerType 'touch'. */
async function touchDrag(page, from, to, { steps = 10, holdMs = 0, id = 1, stepMs = 16 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id }] });
    for (let i = 1; i <= steps; i++) {
      const x = from.x + (to.x - from.x) * i / steps, y = from.y + (to.y - from.y) * i / steps;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id }] });
      await page.waitForTimeout(stepMs);
    }
    if (holdMs) await page.waitForTimeout(holdMs);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await cdp.detach().catch(() => {}); }
}

/** Real touch tap through CDP. */
async function touchTap(page, pt, { holdMs = 50, id = 1 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y, id }] });
    if (holdMs) await page.waitForTimeout(holdMs);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await cdp.detach().catch(() => {}); }
}

/**
 * Multi-touch through CDP. `steps`: `{type:'touchStart'|'touchMove'|'touchEnd', points:[{id,x,y}], waitMs}` or async
 * functions run in between. For `touchEnd` the points listed are the LIFTED ones (CDP semantics).
 */
async function multiTouch(page, steps) {
  const cdp = await page.context().newCDPSession(page);
  try {
    for (const s of steps) {
      if (typeof s === 'function') { await s(); continue; }
      await cdp.send('Input.dispatchTouchEvent', { type: s.type, touchPoints: (s.points || []).map((p) => ({ x: p.x, y: p.y, id: p.id })) });
      if (s.waitMs) await page.waitForTimeout(s.waitMs);
    }
  } finally { await cdp.detach().catch(() => {}); }
}

/** Linear touchMove steps for finger `id` from → to (other held fingers listed in `others`). */
const moveSteps = (id, from, to, n = 6, others = [], waitMs = 16) => Array.from({ length: n }, (_, i) => ({
  type: 'touchMove', points: [...others, { id, x: from.x + (to.x - from.x) * (i + 1) / n, y: from.y + (to.y - from.y) * (i + 1) / n }], waitMs,
}));

module.exports = {
  GAME_PREFIX, MIME, DEVICES, VIEWPORT_DEVICES, BROWSER_ARGS,
  startServer, launchBrowser, openGame, forceTier, waitGame, waitTitle, isVisible, tapSelector, dismissRotateHint,
  startGame, openLineup, nextFrames, frameStats, measureFps, touchDrag, touchTap, multiTouch, moveSteps, chromium,
};

if (require.main === module) {
  (async () => {
    const argv = process.argv.slice(2);
    const get = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
    const dir = path.resolve(get('--dir', path.join(__dirname, '..')));
    const out = get('--out', path.join(__dirname, 'shots'));
    const device = get('--device', 'phonePortrait');
    const query = get('--query', '');
    fs.mkdirSync(out, { recursive: true });
    const g = await openGame({ dir, device, page: 'index.html' + query });
    let title = false;
    try { await waitTitle(g.page, 15000); title = true; } catch (e) { /* report below */ }
    await g.page.screenshot({ path: path.join(out, `${device}-load.png`) });
    const fps = await measureFps(g.page, 2000);
    const screen = await g.page.evaluate(() => (window.__game && window.__game.ui ? window.__game.ui.screen : null));
    console.log(JSON.stringify({ device, title, screen, fps: Math.round(fps), errors: g.diag.errors, pageErrors: g.diag.pageErrors, failedRequests: g.diag.failedRequests, requests: g.diag.requests.length }, null, 2));
    await g.close();
  })().catch((e) => { console.error(e); process.exit(1); });
}
