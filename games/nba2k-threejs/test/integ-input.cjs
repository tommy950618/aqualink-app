// Integrator human-input smoke test on phoneLandscape: joystick drag, hold-to-shoot tap, defence relabel, perf.
const path = require('path');
const { openGame, touchDrag } = require('./harness.cjs');
const dir = path.join(__dirname, '..');
const stick = { x: 844 * 0.15, y: 390 * 0.7 };
(async () => {
  const g = await openGame({ dir, device: 'phoneLandscape', page: 'index.html?seed=7&debug=1' });
  const { page, diag } = g;
  await page.waitForTimeout(500);
  await page.click('#btnStart');
  await page.waitForFunction(() => window.__game.state === 'LIVE', null, { timeout: 4000 });
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => ({ x: window.__game.controlled.pos.x, z: window.__game.controlled.pos.z, off: window.__game.game.userIsOffense(), hasBall: window.__game.controlled.hasBall }));
  // Joystick: press, drag +60 px right, hold 0.4 s (about 2 m at run speed, stays in bounds)
  await touchDrag(page, stick, { x: stick.x + 60, y: stick.y }, { steps: 6, holdMs: 400 });
  const afterX = await page.evaluate(() => ({ x: window.__game.controlled.pos.x, z: window.__game.controlled.pos.z, state: window.__game.state, speed: window.__game.controlled.speed }));
  await page.waitForTimeout(600);
  const speedAfterRelease = await page.evaluate(() => window.__game.controlled.speed);
  // Drag up (toward the hoop)
  await touchDrag(page, stick, { x: stick.x, y: stick.y - 60 }, { steps: 6, holdMs: 400 });
  const afterZ = await page.evaluate(() => ({ x: window.__game.controlled.pos.x, z: window.__game.controlled.pos.z, hasBall: window.__game.controlled.hasBall, state: window.__game.state, ball: window.__game.ball.state }));
  await page.waitForTimeout(600);
  // Hold-to-shoot: touch #btnPrimary, hold 440 ms, release
  const box = await page.$eval('#btnPrimary', (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const pre = await page.evaluate(() => ({ fga: window.__game.world.userPlayer.stats.fga, hasBall: window.__game.controlled.hasBall, off: window.__game.game.userIsOffense(), state: window.__game.state }));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y, id: 1 }] });
  await page.waitForTimeout(200);
  const midHold = await page.evaluate(() => { const m = document.getElementById('meter'); const cs = getComputedStyle(m); return { held: window.__game.input.intent.primary.held, pstate: window.__game.controlled.state, meterDisplay: cs.display, meterOpacity: cs.opacity, meterVis: cs.visibility, cls: m.className, transform: m.style.transform, fill: document.getElementById('meterFill').style.height || document.getElementById('meterFill').style.transform }; });
  await page.screenshot({ path: path.join(__dirname, 'shots', 'integ-phoneLandscape-windup.png') });
  await page.waitForTimeout(240);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(100);
  const shot = await page.evaluate(() => ({ ball: window.__game.ball.state, fga: window.__game.world.userPlayer.stats.fga, kind: window.__game.ball.shotInfo && window.__game.ball.shotInfo.kind, flash: document.getElementById('meterFlash').textContent }));
  await page.screenshot({ path: path.join(__dirname, 'shots', 'integ-phoneLandscape-shot.png') });
  await page.waitForTimeout(3500);
  const afterShot = await page.evaluate(() => ({ state: window.__game.state, score: window.__game.game.score.slice(), ball: window.__game.ball.state, caption: document.getElementById('caption').textContent }));
  // Defence relabel
  await page.waitForFunction(() => window.__game.state === 'LIVE', null, { timeout: 8000 });
  const labelsOff = await page.$$eval('#cluster .label', (els) => els.map((e) => e.textContent));
  const offBefore = await page.evaluate(() => window.__game.game.userIsOffense());
  await page.evaluate(() => window.__game.turnover());
  await page.waitForTimeout(250);
  const def = await page.evaluate(() => ({ cls: document.getElementById('cluster').className, labels: [...document.querySelectorAll('#cluster .label')].map((e) => e.textContent), off: window.__game.game.userIsOffense(), state: window.__game.state }));
  await page.waitForFunction(() => window.__game.state === 'LIVE', null, { timeout: 8000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'integ-phoneLandscape-defense.png') });
  // Perf
  const perf = await page.evaluate(() => { const G = window.__game; const t = performance.now(); G.fastForward(10); const ms = performance.now() - t; return { perStepMs: +(ms / 600).toFixed(3), perf: G.perf, dpr: G.renderer.getPixelRatio() }; });
  console.log(JSON.stringify({ before, afterX, speedAfterRelease, afterZ, pre, midHold, shot, afterShot, labelsOff, offBefore, def, perf, errors: diag.errors, pageErrors: diag.pageErrors, failed: diag.failedRequests }, null, 1));
  await g.close();
})().catch((e) => { console.error(e); process.exit(1); });
