// Integrator boot check: three devices, menu + LIVE screenshots, console/page/request errors.
const path = require('path');
const { openGame } = require('./harness.cjs');
const dir = path.join(__dirname, '..');
(async () => {
  const devices = process.argv.slice(2).length ? process.argv.slice(2) : ['desktop', 'phonePortrait', 'phoneLandscape'];
  let fail = 0;
  for (const device of devices) {
    const g = await openGame({ dir, device, page: 'index.html?seed=7&debug=1' });
    const { page, diag } = g;
    await page.waitForTimeout(800);
    const menuText = await page.evaluate(() => document.body.innerText.includes('开始比赛'));
    await page.screenshot({ path: path.join(__dirname, 'shots', `integ-${device}-menu.png`) });
    await page.click('#btnStart');
    const t0 = Date.now();
    let sawCheck = false, state = '';
    while (Date.now() - t0 < 3500) {
      state = await page.evaluate(() => window.__game && window.__game.state);
      if (state === 'CHECK') sawCheck = true;
      if (state === 'LIVE') break;
      await page.waitForTimeout(50);
    }
    const liveAt = Date.now() - t0;
    await page.waitForTimeout(2000);
    const info = await page.evaluate(() => {
      const g = window.__game;
      const txt = (id) => document.getElementById(id).textContent;
      return {
        players: g.world.players.length,
        bug: [txt('abbrA'), txt('abbrB'), txt('period'), txt('gameClock'), txt('shotClock'), txt('scoreA'), txt('scoreB')],
        perf: g.perf, dpr: g.renderer.getPixelRatio(),
        fov: g.camera.fov,
        ballY: g.ball.pos.y,
      };
    });
    await page.screenshot({ path: path.join(__dirname, 'shots', `integ-${device}-live.png`) });
    const ok = diag.errors.length === 0 && diag.pageErrors.length === 0 && diag.failedRequests.length === 0 && menuText && sawCheck && state === 'LIVE' && info.players === 6;
    if (!ok) fail++;
    console.log(JSON.stringify({ device, ok, menuText, sawCheck, state, liveAt, info, errors: diag.errors, pageErrors: diag.pageErrors, failedRequests: diag.failedRequests, warnings: diag.warnings.slice(0, 5) }, null, 1));
    await g.close();
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
