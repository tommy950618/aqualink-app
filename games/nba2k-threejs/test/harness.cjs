// Playwright playtest harness for the static game one directory up.
// Usage:  node test/harness.cjs [--device phonePortrait|phoneLandscape|androidPortrait|desktop] [--out test/shots]
// Exports: startServer, openGame, measureFps, touchDrag, touchTap, DEVICES for custom scripts (see test/acceptance.cjs).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require('/opt/node22/lib/node_modules/playwright'); } })();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain', '.md': 'text/markdown', '.webmanifest': 'application/manifest+json' };

function startServer(dir, port = 0) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(dir, p);
      if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('404 ' + p); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

const DEVICES = {
  phonePortrait: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  phoneLandscape: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  androidPortrait: { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' },
  desktop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};

async function openGame({ dir, device = 'phonePortrait', url: baseUrl, page: pagePath = 'index.html', headless = true }) {
  const { server, url } = baseUrl ? { server: null, url: baseUrl } : await startServer(dir);
  const browser = await chromium.launch({ headless, args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext(DEVICES[device]);
  const page = await ctx.newPage();
  const diag = { errors: [], warnings: [], logs: [], pageErrors: [], failedRequests: [] };
  page.on('console', (m) => { const t = m.type(); const txt = m.text(); if (t === 'error') diag.errors.push(txt); else if (t === 'warning') diag.warnings.push(txt); else diag.logs.push(`[${t}] ${txt}`); });
  page.on('pageerror', (e) => diag.pageErrors.push(String(e && e.stack || e)));
  page.on('requestfailed', (r) => diag.failedRequests.push(`${r.url()} ${r.failure() && r.failure().errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) diag.failedRequests.push(`${r.url()} HTTP ${r.status()}`); });
  await page.goto(url + pagePath, { waitUntil: 'load' });
  const close = async () => { await browser.close(); if (server) server.close(); };
  return { page, ctx, browser, diag, close, url };
}

// Measures rendered frames per second over `ms` milliseconds using requestAnimationFrame.
async function measureFps(page, ms = 3000) {
  return page.evaluate((ms) => new Promise((resolve) => {
    let frames = 0; const t0 = performance.now();
    const tick = () => { frames++; if (performance.now() - t0 < ms) requestAnimationFrame(tick); else resolve(frames / ((performance.now() - t0) / 1000)); };
    requestAnimationFrame(tick);
  }), ms);
}

// Dispatches a real touch sequence through CDP so pointer events carry pointerType 'touch'.
async function touchDrag(page, from, to, { steps = 10, holdMs = 0, id = 1 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id }] });
  for (let i = 1; i <= steps; i++) {
    const x = from.x + (to.x - from.x) * i / steps, y = from.y + (to.y - from.y) * i / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id }] });
    await page.waitForTimeout(16);
  }
  if (holdMs) await page.waitForTimeout(holdMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

async function touchTap(page, pt, { holdMs = 50, id = 1 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y, id }] });
  await page.waitForTimeout(holdMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

module.exports = { startServer, openGame, measureFps, touchDrag, touchTap, DEVICES };

if (require.main === module) {
  (async () => {
    const argv = process.argv.slice(2);
    const get = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
    const dir = path.resolve(get('--dir', path.join(__dirname, '..')));
    const out = get('--out', path.join(__dirname, 'shots'));
    const device = get('--device', 'phonePortrait');
    fs.mkdirSync(out, { recursive: true });
    const g = await openGame({ dir, device });
    await g.page.waitForTimeout(1500);
    await g.page.screenshot({ path: path.join(out, `${device}-load.png`) });
    const fps = await measureFps(g.page, 2000);
    console.log(JSON.stringify({ device, fps: Math.round(fps), ...g.diag }, null, 2));
    await g.close();
  })().catch((e) => { console.error(e); process.exit(1); });
}
