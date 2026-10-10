'use strict';
/**
 * @module test/integ-boot
 * Integrator boot check for v2 (WP9): per device, boot `index.html?quick=1&intro=0&seed=7`, wait for the title
 * (loading → legends → arena → shader warm-up), screenshot it, start a quick game, wait for CHECK → LIVE, screenshot
 * LIVE and report console / page / request errors, cross-origin requests, the quality tier, pixel ratio, camera fov,
 * score bug text and frame stats.
 *
 * Usage: node test/integ-boot.cjs [device ...]   (default: desktop phonePortrait phoneLandscape)
 *        devices: see test/harness.cjs DEVICES. Screenshots go to test/shots/integ-<device>-{title,live}.png.
 * Exit code 1 when any device fails.
 */
const path = require('path');
const fs = require('fs');
const H = require('./harness.cjs');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');

(async () => {
  const devices = process.argv.slice(2).length ? process.argv.slice(2) : ['desktop', 'phonePortrait', 'phoneLandscape'];
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = await H.startServer(ROOT);
  const browser = await H.launchBrowser();
  let fail = 0;
  try {
    for (const device of devices) {
      const g = await H.openGame({ device, url: srv.url, page: 'index.html?quick=1&intro=0&seed=7', browser });
      const { page, diag } = g;
      const out = { device };
      try {
        const t0 = Date.now();
        await H.waitTitle(page, 120000);
        out.titleMs = Date.now() - t0;
        out.titleText = await page.evaluate(() => document.body.innerText.includes('开始游戏'));
        await page.screenshot({ path: path.join(SHOTS, `integ-${device}-title.png`) });
        await H.dismissRotateHint(page);
        const r = await H.startGame(page);
        out.readyMs = r.readyMs;
        await H.waitGame(page, "g.state === 'LIVE'", 30000, 'LIVE');
        out.liveMs = Date.now() - t0 - out.titleMs;
        await page.waitForTimeout(2000);
        out.info = await page.evaluate(() => {
          const g = window.__game; const txt = (id) => { const el = document.getElementById(id); return el ? el.textContent.trim() : null; };
          return {
            players: g.world.players.length, simplified: !!g.simplified, characters: g.characters ? Object.keys(g.characters).length : 0,
            bug: ['abbrA', 'abbrB', 'period', 'gameClock', 'shotClock', 'scoreA', 'scoreB'].map(txt),
            dpr: g.renderer.getPixelRatio(), fov: g.director && g.director.camera ? +g.director.camera.fov.toFixed(1) : null,
            quality: g.quality ? { tier: g.quality.tier, rung: g.quality.rung, auto: g.quality.auto } : null, screen: g.ui && g.ui.screen,
          };
        });
        out.frame = await H.frameStats(page);
        await page.screenshot({ path: path.join(SHOTS, `integ-${device}-live.png`) });
      } catch (e) { out.error = e.message; }
      const origin = new URL(srv.url).origin;
      out.crossOrigin = diag.requests.filter((q) => !q.url.startsWith(origin + '/') && !/^(data|blob|about):/.test(q.url)).map((q) => q.url);
      out.errors = diag.errors; out.pageErrors = diag.pageErrors; out.failedRequests = diag.failedRequests; out.warnings = diag.warnings.slice(0, 5);
      out.requests = diag.requests.length;
      out.ok = !out.error && out.titleText && diag.errors.length === 0 && diag.pageErrors.length === 0 && diag.failedRequests.length === 0 && out.crossOrigin.length === 0 && out.info && out.info.players === 6;
      if (!out.ok) fail++;
      console.log(JSON.stringify(out, null, 1));
      await g.close();
    }
  } finally { await browser.close(); await srv.close(); }
  console.log(fail ? `${fail} device(s) failed` : 'all devices ok');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
