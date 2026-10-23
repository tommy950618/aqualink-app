/* DEV ONLY — reproduces the reference 培养 screenshot setup (佐助·须佐能乎 Lv.340 ★6 with a 5-man team)
 * and captures a few hard-to-time states (ult cut-in, UR showcase) for visual review.
 * NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/_ui_ref.js [outDir] */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const OUT = process.argv[2] || '/tmp/claude-0/-home-user-aqualink-app/7b37f5eb-8962-565a-b27d-4cf648e4c413/scratchpad/ui_shots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const px = process.env.FONTS === 'net' && (process.env.HTTPS_PROXY || process.env.https_proxy);
  const browser = await chromium.launch({ proxy: px ? { server: px, bypass: 'localhost,127.0.0.1' } : undefined });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  if (process.env.FONTS !== 'net') await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, body: '' }));
  await page.goto('http://localhost:8123/index.html');
  await page.waitForSelector('#boot', { state: 'detached', timeout: 10000 });
  const team = await page.evaluate(() => {
    const want = ['sasuke_ms', 'kakashi_ms', 'obito', 'pain', 'sakura_byakugou'];
    const ids = want.filter((id) => NG.CHAR_MAP[id]);
    const st = NG.game.state;
    st.flags.welcomed = true;
    ids.forEach((id, i) => { st.roster[id] = { lv: 340, star: i ? 5 : 6, shards: 0, skills: { passive: 9, s1: 9, s2: 9, ult: 9, awaken: 9 }, obtained: Date.now() }; });
    NG.game.save(); NG.game.setTeam(ids);
    NG.ui.closeModals(); NG.ui.go('train', { id: ids[0], tab: 'skill' });
    return ids;
  });
  console.log('team', team);
  await sleep(1400);
  await page.screenshot({ path: path.join(OUT, 'ref_train.png') });
  // cut-in: mid-level team vs a later stage so the fight runs long enough for ults
  await page.evaluate(() => {
    const st = NG.game.state;
    NG.game.state.team.forEach((id) => { st.roster[id].lv = 60; st.roster[id].star = 2; });
    NG.game.save();
    const chs = NG.game.chapters(); const sid = chs[2].stages[3].id;
    const orig = NG.game.stageState; NG.game.stageState = (x) => x === sid ? { unlocked: true, stars: 0 } : orig(x);
    NG.ui.setSetting('speed', 1);
    NG.ui.startBattle(sid);
  });
  let got = false;
  for (let i = 0; i < 1200 && !got; i++) {
    if (await page.locator('.cutin .sname').count()) { await sleep(520); await page.screenshot({ path: path.join(OUT, 'ref_cutin.png') }); got = true; }
    else await sleep(50);
  }
  console.log('cutin captured:', got);
  for (let i = 0; i < 60; i++) { if (await page.locator('.bt-fx .fxe').count() >= 3) { await page.screenshot({ path: path.join(OUT, 'ref_fx.png') }); break; } await sleep(60); }
  // boss stage
  await page.evaluate(() => {
    NG.ui.closeModals();
    const chs = NG.game.chapters(); const s = chs[0].stages[chs[0].stages.length - 1].id;
    const orig = NG.game._ssOrig || NG.game.stageState; NG.game._ssOrig = orig;
    NG.game.stageState = (x) => x === s ? { unlocked: true, stars: 0 } : orig(x);
    NG.ui.setSetting('speed', 1); NG.ui.startBattle(s);
  });
  await sleep(2600);
  await page.screenshot({ path: path.join(OUT, 'ref_boss.png') });
  await page.click('[data-a="skip"]'); await page.waitForSelector('.res', { timeout: 20000 }); await sleep(1500);
  await page.screenshot({ path: path.join(OUT, 'ref_boss_result.png') });
  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO ERRORS');
})();
