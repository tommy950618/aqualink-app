/* DEV ONLY — captures the review screenshots (主城 / 召唤 / 百连结果 / 培养 / 图鉴 / 编队 / 冒险 / 战斗 / 战斗大招 / 结算)
 * from a fresh save played through the real UI (welcome → 百连 → …), at 1280×720 unless VP=portrait|landscape|ipad.
 *   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/_shots.js [outDir] */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const OUT = process.argv[2] || '/tmp/claude-0/-home-user-aqualink-app/7b37f5eb-8962-565a-b27d-4cf648e4c413/scratchpad/final';
const BASE = process.env.BASE || 'http://localhost:8133/index.html';
const VPS = {
  desktop: { viewport: { width: 1280, height: 720 } },
  portrait: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  landscape: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ipad: { viewport: { width: 1024, height: 1366 }, isMobile: true, hasTouch: true }
};
const VP = process.env.VP || 'desktop';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--disable-gpu'], proxy: process.env.FONTS === 'net' && process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost' } : undefined });
  const ctx = await browser.newContext(VPS[VP]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  if (process.env.FONTS !== 'net') await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, body: '' }));
  const pre = VP === 'desktop' ? '' : VP + '_';
  const shot = (n) => page.screenshot({ path: path.join(OUT, pre + n + '.png') });
  const click = async (sel, w) => { await page.locator(sel).filter({ visible: true }).first().click(); await sleep(w == null ? 500 : w); };
  await page.goto(BASE);
  await page.waitForSelector('#boot', { state: 'detached' });
  await sleep(800);
  await click('.welcome .btn', 900);
  await shot('02_召唤');
  await click('.sm-btn[data-n="100"]', 400);
  for (let i = 0; i < 200; i++) {
    if (await page.locator('.rv-bar:not(.hidden) [data-a="ok"]').count()) break;
    const s = page.locator('.ur-show .rv-skip, .rv > .rv-skip:not(.hidden)');
    if (await s.count()) await s.first().click({ timeout: 1000 }).catch(() => {});
    await sleep(200);
  }
  await sleep(1600);
  await shot('03_百连结果');
  await click('.rv-bar [data-a="ok"]');
  // a few more pulls so the roster is broad, then a strong reference-like team
  await page.evaluate(() => {
    for (let i = 0; i < 4; i++) NG.game.summon(100);
    const want = ['sasuke_ms', 'kakashi_ms', 'obito', 'pain', 'sakura_byakugou'].filter((id) => NG.CHAR_MAP[id]);
    const st = NG.game.state;
    want.forEach((id, i) => { st.roster[id] = st.roster[id] || { shards: 0, obtained: Date.now() }; Object.assign(st.roster[id], { lv: 340, star: i ? 5 : 6, skills: { passive: 9, s1: 9, s2: 9, ult: 9, awaken: 9 } }); });
    NG.game.save(); NG.game.setTeam(want);
  });
  await click('.tb-back', 900);
  await sleep(1200);
  await shot('01_主城');
  await page.evaluate(() => NG.ui.go('train', { id: NG.game.state.team[0], tab: 'skill' }));
  await sleep(1400);
  await shot('04_培养');
  await page.evaluate(() => NG.ui.go('codex')); await sleep(4500);
  await shot('05_图鉴');
  await page.evaluate(() => document.querySelector('.scr-codex .cx-card:not(.off)').click()); await sleep(900);
  await shot('05b_图鉴详情');
  await page.evaluate(() => { NG.ui.closeModals(); NG.ui.go('team'); }); await sleep(1500);
  await shot('06_编队');
  // campaign at a mid chapter (clear the first chapters through the engine so the map shows progress)
  await page.evaluate(() => {
    const chs = NG.game.chapters();
    for (let c = 0; c < 2; c++) chs[c].stages.forEach((s) => { const r = NG.game.battleStage(s.id); if (r.winner === 'A') NG.game.finishStage(s.id, r); });
    NG.ui.go('campaign');
  });
  await sleep(1300);
  await shot('07_冒险');
  // battle at ×1 against a stage strong enough for ults to fire
  await page.evaluate(() => {
    const st = NG.game.state; st.team.forEach((id) => { st.roster[id].lv = 90; st.roster[id].star = 2; }); NG.game.save();
    NG.ui.setSetting('speed', 1);
    const chs = NG.game.chapters(); const sid = chs[2].stages[chs[2].stages.length - 1].id;
    const orig = NG.game.stageState; NG.game.stageState = (x) => (x === sid ? { unlocked: true, stars: 0 } : orig(x));
    NG.ui.startBattle(sid);
  });
  let mid = false, cut = false;
  for (let i = 0; i < 2400 && !(mid && cut); i++) {
    if (!mid && i > 60 && await page.locator('.bt-fx .dmg').count() >= 2) { await shot('08_战斗'); mid = true; }
    if (!cut && await page.locator('#fx .cutin .sname').count()) { await sleep(700); await shot('09_战斗大招'); cut = true; }
    if (await page.locator('#modals .res').count()) break;
    await sleep(50);
  }
  if (!await page.locator('#modals .res').count()) { await page.click('.scr-battle [data-a="skip"]'); await page.waitForSelector('#modals .res', { timeout: 30000 }); }
  await sleep(1800);
  await shot('10_结算');
  console.log('cut-in', cut, 'mid', mid);
  console.log(errs.length ? 'ERRORS\n' + errs.join('\n') : 'NO ERRORS');
  await browser.close();
})();
