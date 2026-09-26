// Layout / DOM checks for index.html + css/style.css + src/input.js + src/hud.js (no main.js needed).
// Run: node test/layout-check.cjs
// Injects a small bootstrap that constructs Input and HUD so the interaction checks run without main.js.
const path = require('path');
const fs = require('fs');
const { openGame, DEVICES } = require('./harness.cjs');

const dir = path.resolve(__dirname, '..');
const shots = path.join(__dirname, 'shots');
fs.mkdirSync(shots, { recursive: true });

const BOOT = `
  import { Input, makeIntent } from './src/input.js';
  import { HUD } from './src/hud.js';
  import { setLang, applyDom } from './src/i18n.js';
  applyDom(document);
  const calls = [];
  const input = new Input(document, { onGesture: () => calls.push('gesture') });
  const hud = new HUD(document, {
    onStart: (o) => calls.push(['start', o]), onResume: () => calls.push('resume'), onQuit: () => calls.push('quit'),
    onRematch: () => calls.push('rematch'), onSetting: (k, v) => calls.push(['setting', k, v]), onLang: (l) => calls.push(['lang', l]), onSkip: () => calls.push('skip'),
  });
  hud.bind(null, input, { muted: false, setMuted() {}, click() {} });
  window.__t = { input, hud, calls, makeIntent, setLang };
`;

let failures = 0;
function check(name, ok, extra) {
  console.log((ok ? 'ok   - ' : 'FAIL - ') + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : ''));
  if (!ok) failures++;
}

const inside = (b, w, h) => b.x >= 0 && b.y >= 0 && b.x + b.width <= w + 0.5 && b.y + b.height <= h + 0.5;
const intersects = (a, b) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);

async function boot(page) {
  await page.addScriptTag({ type: 'module', content: BOOT });
  await page.waitForFunction(() => !!window.__t, null, { timeout: 5000 });
}

async function layoutChecks(device, viewport) {
  const g = await openGame({ dir, device });
  const { page } = g;
  if (viewport) await page.setViewportSize(viewport);
  await boot(page);
  const w = viewport ? viewport.width : DEVICES[device].viewport.width;
  const h = viewport ? viewport.height : DEVICES[device].viewport.height;
  const tag = `${w}x${h}`;
  const r = await page.evaluate(() => {
    const box = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
    const se = document.scrollingElement;
    return {
      scrollWidth: se.scrollWidth, scrollHeight: se.scrollHeight, innerWidth: innerWidth, innerHeight: innerHeight,
      bodyTA: getComputedStyle(document.body).touchAction, canvasTA: getComputedStyle(document.getElementById('gl')).touchAction,
      primary: box('btnPrimary'), secondary: box('btnSecondary'), tertiary: box('btnTertiary'), sprint: box('btnSprint'), pause: box('btnPause'),
      bug: box('scoreBug'), zone: box('stickZone'), cluster: box('cluster'), menu: box('menuMain'),
      text: document.body.innerText, emptyI18n: [...document.querySelectorAll('[data-i18n]')].filter((e) => !e.textContent.trim()).length,
      canvas: { w: document.getElementById('gl').clientWidth, h: document.getElementById('gl').clientHeight },
      rotate: !document.getElementById('rotateHint').classList.contains('hidden'),
      menuOverflow: document.getElementById('menuMain').scrollHeight > document.getElementById('menuMain').clientHeight + 1,
    };
  });
  check(`${tag} no scroll`, r.scrollWidth === r.innerWidth && r.scrollHeight === r.innerHeight, [r.scrollWidth, r.innerWidth, r.scrollHeight, r.innerHeight]);
  check(`${tag} touch-action none`, r.bodyTA === 'none' && r.canvasTA === 'none', [r.bodyTA, r.canvasTA]);
  for (const k of ['primary', 'secondary', 'tertiary']) check(`${tag} ${k} >= 56x56 inside`, r[k].width >= 56 && r[k].height >= 56 && inside(r[k], w, h), r[k]);
  check(`${tag} sprint >= 132x56 inside`, r.sprint.width >= 132 && r.sprint.height >= 56 && inside(r.sprint, w, h), r.sprint);
  check(`${tag} pause >= 44 inside`, r.pause.width >= 44 && r.pause.height >= 44 && inside(r.pause, w, h), r.pause);
  check(`${tag} scoreBug !∩ btnPrimary`, !intersects(r.bug, r.primary), [r.bug, r.primary]);
  check(`${tag} zone !∩ cluster`, !intersects(r.zone, r.cluster), [r.zone, r.cluster]);
  check(`${tag} canvas == viewport`, r.canvas.w === w && r.canvas.h === h, r.canvas);
  check(`${tag} shows 开始比赛`, r.text.includes('开始比赛'));
  check(`${tag} no empty [data-i18n]`, r.emptyI18n === 0, r.emptyI18n);
  check(`${tag} main menu fits (no inner overflow)`, !r.menuOverflow, r.menu);
  check(`${tag} rotate hint ${h > w ? 'shown' : 'hidden'}`, r.rotate === (h > w));
  await page.screenshot({ path: path.join(shots, `menu-${tag}.png`) });
  // Hide the menu to shoot the in-game HUD + controls.
  await page.evaluate(() => { window.__t.hud.showMenu(null); window.__t.hud.dismissRotateHint(); window.__t.hud.caption('cap.make3', { name: 'Lin Hai' }); window.__t.hud.banner('banner.check', null, 5000); window.__t.hud.setMeter(0.7, 0.06, true, innerWidth * 0.5, innerHeight * 0.45); window.__t.hud.update(0.016, { teams: null, offense: 0, quarter: 2, gameClock: 83.2, shotClock: 4.2, userPlayer: { stamina: 0.2 } }); });
  await page.screenshot({ path: path.join(shots, `hud-${tag}.png`) });
  const hudText = await page.evaluate(() => ({ period: document.getElementById('period').textContent, clock: document.getElementById('gameClock').textContent, shot: document.getElementById('shotClock').textContent, warn: document.getElementById('shotClock').classList.contains('warn'), possA: document.getElementById('possA').classList.contains('on'), cap: document.getElementById('caption').textContent }));
  check(`${tag} hud text`, hudText.period === '第2节' && hudText.clock === '01:24' && hudText.shot === '5' && hudText.warn && hudText.possA && hudText.cap === 'Lin Hai 三分命中！', hudText);
  await g.close();
}

async function interactionChecks() {
  const g = await openGame({ dir, device: 'phoneLandscape' });
  const { page, diag } = g;
  await boot(page);
  await page.evaluate(() => window.__t.hud.showMenu(null));
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const sample = () => page.evaluate(() => { const it = window.__t.input.sample(); return JSON.parse(JSON.stringify(it)); });
  const box = (id) => page.evaluate((id) => { const b = document.getElementById(id).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, id);

  // Joystick: down at (15%, 70%), move +60 x.
  await touch('touchStart', [{ x: 844 * 0.15, y: 390 * 0.7, id: 1 }]);
  await touch('touchMove', [{ x: 844 * 0.15 + 60, y: 390 * 0.7, id: 1 }]);
  let it = await sample();
  check('stick right -> move.x ~ 1', it.move.x > 0.95 && Math.abs(it.move.z) < 0.05 && it.move.mag > 0.95, it.move);
  await touch('touchMove', [{ x: 844 * 0.15 + 60, y: 390 * 0.7 - 200, id: 1 }]);
  it = await sample();
  check('stick far up -> move.z ~ -1 (tethered)', it.move.z < -0.9 && it.move.mag > 0.99, it.move);
  const ringPos = await page.evaluate(() => document.getElementById('stickRing').style.transform);
  check('ring centre trailed the finger (tether)', /translate3d\(\d+(\.\d+)?px,\s*\d+(\.\d+)?px/.test(ringPos), ringPos);
  await touch('touchMove', [{ x: 844 * 0.15 + 60, y: 390 * 0.7 - 200 + 56, id: 1 }]);
  await touch('touchMove', [{ x: 844 * 0.15 + 60, y: 390 * 0.7 - 200 + 56, id: 1 }]);
  await touch('touchMove', [{ x: 844 * 0.15 + 60, y: 390 * 0.7 - 200 + 56 + 30, id: 1 }]);
  it = await sample();
  check('stick small -> deadzone/partial', it.move.mag < 1 && it.move.mag > 0 && it.move.z > 0.3, it.move);
  const centre = await page.evaluate(() => { const m = /translate3d\(([\d.]+)px, ([\d.]+)px/.exec(document.getElementById('stickRing').style.transform); return { x: +m[1], y: +m[2] }; });
  await touch('touchMove', [{ x: centre.x + 3, y: centre.y + 3, id: 1 }]);
  it = await sample();
  check('stick inside dead zone -> 0', it.move.mag === 0 && it.move.x === 0 && it.move.z === 0, it.move);
  const F1 = { x: 844 * 0.15 + 60, y: 390 * 0.7 - 200 + 56 + 30, id: 1 };
  await touch('touchMove', [F1]);
  const ringVisible = await page.evaluate(() => document.getElementById('stickRing').classList.contains('active'));
  check('ring visible while held', ringVisible);
  // Multi-touch: second finger on sprint while stick held.
  const sp = await box('btnSprint');
  await touch('touchStart', [F1, { x: sp.x, y: sp.y, id: 2 }]);
  it = await sample();
  check('sprint held with stick active', it.sprint === true && it.move.mag > 0, { sprint: it.sprint, mag: it.move.mag });
  // Slide-over: finger 2 moves onto primary.
  const pr = await box('btnPrimary');
  await touch('touchMove', [F1, { x: pr.x, y: pr.y, id: 2 }]);
  it = await sample();
  check('slide-over sprint -> primary', it.primary.held === true && it.primary.justPressed === true && it.sprint === false && it.primary.pressTs > 0, { held: it.primary.held, jp: it.primary.justPressed, sprint: it.sprint });
  const pressedCls = await page.evaluate(() => [document.getElementById('btnPrimary').classList.contains('pressed'), document.getElementById('btnSprint').classList.contains('pressed')]);
  check('pressed class follows slide-over', pressedCls[0] === true && pressedCls[1] === false, pressedCls);
  await page.waitForTimeout(120);
  // Release finger 2 only (CDP touchEnd releases exactly the listed points).
  await touch('touchEnd', [{ x: pr.x, y: pr.y, id: 2 }]);
  it = await sample();
  check('primary released: justReleased, heldTime>0.1, releaseTs>pressTs', it.primary.held === false && it.primary.justReleased && it.primary.heldTime > 0.1 && it.primary.releaseTs > it.primary.pressTs, it.primary);
  check('stick still active after other finger up', it.move.mag > 0, it.move);
  it = await sample();
  check('edges cleared next sample', !it.primary.justReleased && !it.primary.justPressed);
  await touch('touchEnd', []);
  it = await sample();
  check('stick released -> move 0, ring hidden', it.move.mag === 0 && it.move.x === 0, it.move);
  // Tap (press+release inside one step) yields both edges.
  const sec = await box('btnSecondary');
  await touch('touchStart', [{ x: sec.x, y: sec.y, id: 3 }]);
  await touch('touchEnd', []);
  it = await sample();
  check('tap -> justPressed && justReleased in one step', it.secondary.justPressed && it.secondary.justReleased && !it.secondary.held);
  // Second finger in zone ignored.
  await touch('touchStart', [{ x: 100, y: 300, id: 4 }]);
  await touch('touchStart', [{ x: 100, y: 300, id: 4 }, { x: 200, y: 300, id: 5 }]);
  await touch('touchMove', [{ x: 100, y: 300, id: 4 }, { x: 260, y: 300, id: 5 }]);
  it = await sample();
  check('second finger in zone ignored', it.move.mag === 0, it.move);
  await touch('touchEnd', []);
  // setOffense relabels + class.
  await page.evaluate(() => window.__t.input.setOffense(false));
  let labels = await page.evaluate(() => ['btnPrimary', 'btnSecondary', 'btnTertiary', 'btnSprint'].map((id) => document.querySelector('#' + id + ' .label').textContent).concat([document.getElementById('cluster').className]));
  check('defense labels', labels.join() === '盖帽,换人,抢断,冲刺,defense', labels);
  await page.evaluate(() => { window.__t.input.setOffense(true); window.__t.hud.showMenu('main'); });
  await page.click('[data-action=lang]');
  labels = await page.evaluate(() => ['btnPrimary', 'btnSecondary', 'btnTertiary', 'btnSprint'].map((id) => document.querySelector('#' + id + ' .label').textContent).concat([document.getElementById('cluster').className, document.getElementById('btnStart').textContent, document.title]));
  check('offense labels after lang toggle (en)', labels.join() === 'SHOOT,PASS,CROSS,SPRINT,offense,Start Game,HOOP ARENA 3x3', labels);
  const bodyText = await page.evaluate(() => document.body.innerText);
  check('en: no 开始比赛, has Start Game', !bodyText.includes('开始比赛') && bodyText.includes('Start Game'));
  await page.click('[data-action=lang]');
  const zhAgain = await page.evaluate(() => document.body.innerText.includes('开始比赛') && document.querySelector('[data-action=lang]').textContent === '简体中文');
  check('zh restored + lang button label', zhAgain);
  // Keyboard (menu hidden so input is enabled).
  await page.evaluate(() => window.__t.hud.showMenu(null));
  await page.keyboard.down('KeyD'); await page.keyboard.down('KeyW');
  it = await sample();
  check('keys D+W -> normalised diagonal', Math.abs(it.move.x - 0.7071) < 0.01 && Math.abs(it.move.z + 0.7071) < 0.01 && it.move.mag === 1, it.move);
  await page.keyboard.up('KeyD'); await page.keyboard.up('KeyW');
  await page.keyboard.down('Space'); await page.keyboard.down('Shift');
  it = await sample();
  check('Space+Shift -> primary held, sprint', it.primary.held && it.sprint);
  await page.keyboard.up('Space'); await page.keyboard.up('Shift');
  it = await sample();
  check('Space up -> justReleased', it.primary.justReleased && !it.primary.held && !it.sprint);
  await page.keyboard.press('KeyP');
  it = await sample();
  check('P without onPause -> intent.pause.justPressed', it.pause.justPressed === true);
  it = await sample();
  check('pause edge cleared', it.pause.justPressed === false);
  // Menu options + callbacks.
  await page.evaluate(() => window.__t.hud.showMenu('main'));
  await page.click('[data-team="1"]'); await page.click('[data-setting=difficulty][data-value=hard]'); await page.click('[data-setting=quarter][data-value="60"]'); await page.click('[data-action=sound]');
  await page.click('#btnStart');
  const calls = await page.evaluate(() => window.__t.calls);
  const start = calls.find((c) => Array.isArray(c) && c[0] === 'start');
  check('onStart options', !!start && start[1].team === 1 && start[1].difficulty === 'hard' && start[1].quarter === 60 && start[1].sound === false && start[1].lang === 'zh', start && start[1]);
  check('gesture callback fired', calls.includes('gesture'));
  const soundLabel = await page.evaluate(() => document.querySelector('[data-action=sound]').textContent);
  check('sound button shows 关', soundLabel === '关', soundLabel);
  const inputDisabled = await page.evaluate(() => window.__t.input.enabled);
  check('input disabled while menu shown', inputDisabled === false);
  // Over menu with box score.
  await page.evaluate(() => window.__t.hud.showMenu('over', { winner: 1, score: [18, 21], rows: [
    { name: { zh: '林海', en: 'Lin Hai' }, pts: 8, fgm: 3, fga: 7, tpm: 2, reb: 1, stl: 0, blk: 0, team: 0 },
    { name: { zh: '周潮', en: 'Zhou Chao' }, pts: 6, fgm: 3, fga: 5, tpm: 0, reb: 2, stl: 1, blk: 0, team: 0 },
    { name: { zh: '石岳', en: 'Shi Yue' }, pts: 4, fgm: 2, fga: 4, tpm: 0, reb: 3, stl: 0, blk: 1, team: 0 },
    { name: { zh: '赵炎', en: 'Zhao Yan' }, pts: 9, fgm: 4, fga: 8, tpm: 1, reb: 0, stl: 1, blk: 0, team: 1 },
    { name: { zh: '胡烈', en: 'Hu Lie' }, pts: 6, fgm: 3, fga: 6, tpm: 0, reb: 2, stl: 0, blk: 0, team: 1 },
    { name: { zh: '岩铮', en: 'Yan Zheng' }, pts: 6, fgm: 3, fga: 3, tpm: 0, reb: 4, stl: 0, blk: 2, team: 1 },
  ] }));
  const over = await page.evaluate(() => ({ rows: document.querySelectorAll('#boxRows tr').length, winner: document.getElementById('overWinner').textContent, score: document.getElementById('finalScore').textContent, overflow: document.getElementById('menuOver').scrollHeight > document.getElementById('menuOver').clientHeight + 1, visible: !document.getElementById('menuOver').classList.contains('hidden') }));
  check('over menu: 6 rows, winner line, fits', over.rows === 6 && over.winner === '赤岩火狐 获胜' && over.score === '海城潮汐 18 : 21 赤岩火狐' && !over.overflow && over.visible, over);
  await page.screenshot({ path: path.join(shots, 'over-844x390.png') });
  await page.evaluate(() => window.__t.hud.showMenu('pause'));
  const pauseFits = await page.evaluate(() => document.getElementById('menuPause').scrollHeight <= document.getElementById('menuPause').clientHeight + 1);
  check('pause menu fits', pauseFits);
  await page.screenshot({ path: path.join(shots, 'pause-844x390.png') });
  await page.evaluate(() => window.__t.hud.showMenu('halftime', { score: [10, 12] }));
  await page.screenshot({ path: path.join(shots, 'halftime-844x390.png') });
  await page.click('#halftime');
  const skipped = await page.evaluate(() => window.__t.calls.includes('skip'));
  check('halftime tap -> onSkip', skipped);
  // Safe-area fallback variable: cluster bottom >= 50 px above the viewport bottom.
  await page.evaluate(() => { document.documentElement.style.setProperty('--safe-bottom', '34px'); });
  const clusterBottom = await page.evaluate(() => innerHeight - document.getElementById('cluster').getBoundingClientRect().bottom);
  check('--safe-bottom:34px -> cluster bottom gap >= 50', clusterBottom >= 50, clusterBottom);
  // Wheel must not scroll.
  await page.mouse.wheel(0, 400);
  const scrollY = await page.evaluate(() => scrollY);
  check('wheel does not scroll', scrollY === 0, scrollY);
  const onlyMain404 = diag.failedRequests.every((s) => /src\/main\.js/.test(s));
  const bad = diag.errors.filter((s) => !/404/.test(s)).concat(diag.pageErrors);
  check('no console/page errors (main.js 404 excluded)', bad.length === 0 && onlyMain404, { bad, failed: diag.failedRequests });
  await cdp.detach();
  await g.close();
}

(async () => {
  await layoutChecks('phonePortrait');
  await layoutChecks('phoneLandscape');
  await layoutChecks('androidPortrait');
  await layoutChecks('desktop');
  await layoutChecks('phoneLandscape', { width: 812, height: 375 });
  await layoutChecks('phonePortrait', { width: 375, height: 812 });
  await interactionChecks();
  console.log(failures === 0 ? 'ALL OK' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
