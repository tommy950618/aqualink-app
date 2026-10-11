'use strict';
/**
 * @module test/integ-input
 * Integrator human-input smoke test for v2 on phoneLandscape (844×390, touch): joystick drag (+x, then toward the
 * hoop), release stop, hold-to-shoot on #btnPrimary for the controlled legend's `getTiming(id, 'jumper', 'set').tIdeal`
 * (meter visible mid-hold, ball in flight and FGA +1 after release), quick SHOOT tap → pump fake, defence relabel after
 * `__game.turnover()`, SWITCH on defence, and the step cost of `fastForward(10)`.
 *
 * Usage: node test/integ-input.cjs   Screenshots: test/shots/integ-phoneLandscape-{windup,shot,defense}.png.
 * Exit code 1 when a check fails.
 */
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const H = require('./harness.cjs');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');
const ev = (page, expr) => page.evaluate(`(() => { const g = window.__game; return (${expr}); })()`);
const ctrlId = `(() => { const c = g.controlled; return c && (c.id || c.legendId || (c.legend && c.legend.id)); })()`;
const pos = `(() => { const c = g.controlled; const p = c.pos || c; return { x: p.x, z: p.z, speed: Math.hypot(c.vel ? c.vel.x : 0, c.vel ? (c.vel.z ?? c.vel.y) : 0) }; })()`;

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const { getTiming } = await import(pathToFileURL(path.join(ROOT, 'src/anim/select.js')).href);
  const srv = await H.startServer(ROOT);
  const g = await H.openGame({ device: 'phoneLandscape', url: srv.url, page: 'index.html?quick=1&intro=0&seed=7' });
  const { page, diag } = g; const checks = []; const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });
  try {
    await H.startGame(page);
    await H.waitGame(page, "g.state === 'LIVE'", 30000, 'LIVE');
    await page.waitForTimeout(400);
    const zone = await page.evaluate(() => { const r = document.querySelector('#stickZone').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const stick = { x: Math.round(Math.max(zone.x + 100, 844 * 0.15)), y: Math.round(Math.min(zone.y + zone.h * 0.6, zone.y + zone.h - 70)) };
    const b0 = await ev(page, pos);
    await H.touchDrag(page, stick, { x: stick.x + 60, y: stick.y }, { steps: 6, holdMs: 500 });
    const b1 = await ev(page, pos);
    check('joystick +x moves the handler', b1.x - b0.x > 0.5, { from: b0, to: b1 });
    await page.waitForTimeout(700);
    check('release stops the handler', (await ev(page, pos)).speed < 0.3, await ev(page, pos));
    await H.touchDrag(page, stick, { x: stick.x, y: stick.y - 60 }, { steps: 6, holdMs: 500 });
    const b2 = await ev(page, pos);
    check('joystick up moves toward the hoop (z decreases)', b2.z < b1.z, { before: b1, after: b2 });
    await page.waitForTimeout(600);
    // hold-to-shoot for tIdeal
    await H.waitGame(page, "g.state === 'LIVE' && g.controlled === g.ball.owner", 20000, 'user holds the ball');
    const id = await ev(page, ctrlId); const tim = getTiming(id, 'jumper', 'set');
    const fga0 = await ev(page, `g.player(${JSON.stringify(id)}).stats.fga`);
    const box = await page.locator('#btnPrimary').boundingBox(); const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...c, id: 1 }] });
    await page.waitForTimeout(Math.round(tim.tIdeal * 1000 * 0.5));
    const mid = await page.evaluate(() => { const m = document.getElementById('meter'); const cs = getComputedStyle(m); return { held: window.__game.input.intent.primary.held, display: cs.display, opacity: cs.opacity, meter: window.__game.game.meter && window.__game.game.meter.active }; });
    await page.screenshot({ path: path.join(SHOTS, 'integ-phoneLandscape-windup.png') });
    await page.waitForTimeout(Math.round(tim.tIdeal * 1000 * 0.5));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    check('meter active during the hold', mid.held && mid.meter, mid);
    await H.waitGame(page, "g.ball.state === 'flight' || g.ball.state === 'scored'", 5000, 'ball in flight').catch(() => {});
    const shot = await ev(page, `({ ball: g.ball.state, fga: g.player(${JSON.stringify(id)}).stats.fga, flash: document.getElementById('meterFlash').textContent })`);
    await page.screenshot({ path: path.join(SHOTS, 'integ-phoneLandscape-shot.png') });
    check(`hold ${Math.round(tim.tIdeal * 1000)} ms → shot (FGA +1)`, shot.fga === fga0 + 1, shot);
    // quick SHOOT tap → pump fake (no FGA)
    await H.waitGame(page, "g.state === 'LIVE' && g.controlled === g.ball.owner", 30000, 'user holds the ball again').catch(() => {});
    const id2 = await ev(page, ctrlId); const fgaQ = await ev(page, `g.player(${JSON.stringify(id2)}).stats.fga`);
    const evN = await ev(page, '(g.events || []).length');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...c, id: 1 }] });
    await page.waitForTimeout(50);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(700);
    const pf = await ev(page, `({ fga: g.player(${JSON.stringify(id2)}).stats.fga, pump: (g.events || []).slice(-64).some((e) => e && (e.type === 'pumpFake' || e.evt === 'pumpFake' || e.name === 'pumpFake')), n: (g.events || []).length })`);
    check('quick SHOOT tap is a pump fake (no FGA)', pf.fga === fgaQ, { ...pf, before: evN });
    await cdp.detach();
    // defence relabel + SWITCH
    await H.waitGame(page, "g.state === 'LIVE'", 20000, 'LIVE');
    await ev(page, 'g.turnover()');
    await page.waitForTimeout(300);
    const def = await page.evaluate(() => ({ cls: document.getElementById('cluster').className, labels: [...document.querySelectorAll('#cluster .label')].map((e) => e.textContent) }));
    check('defence relabel (#cluster.defense, 盖帽/换人/抢断)', /\bdefense\b/.test(def.cls) && def.labels.some((l) => l.includes('盖帽')), def);
    await H.waitGame(page, "g.state === 'LIVE'", 20000, 'LIVE on defence');
    const c0 = await ev(page, ctrlId);
    await H.tapSelector(page, '#btnSecondary');
    await page.waitForTimeout(400);
    check('SWITCH changes the controlled defender', (await ev(page, ctrlId)) !== c0, { before: c0, after: await ev(page, ctrlId) });
    await page.screenshot({ path: path.join(SHOTS, 'integ-phoneLandscape-defense.png') });
    const perf = await page.evaluate(() => { const G = window.__game; const t = performance.now(); G.fastForward(10); return { perStepMs: +((performance.now() - t) / 600).toFixed(3), perf: G.perf, dpr: G.renderer.getPixelRatio() }; });
    check('fastForward(10) mean step < 1.5 ms', perf.perStepMs < 1.5, perf);
  } catch (e) { checks.push({ name: 'exception', ok: false, detail: e.message }); }
  check('no console / page errors', diag.errors.length === 0 && diag.pageErrors.length === 0, { errors: diag.errors.slice(0, 3), pageErrors: diag.pageErrors.slice(0, 2), failed: diag.failedRequests.slice(0, 3) });
  await g.close(); await srv.close();
  for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name} ${JSON.stringify(c.detail)}`);
  const bad = checks.filter((c) => !c.ok).length;
  console.log(bad ? `${bad} check(s) failed` : 'all input checks ok');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
